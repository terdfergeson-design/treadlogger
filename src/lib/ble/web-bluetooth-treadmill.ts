import {
  ControlOpCode,
  pause as pauseCommand,
  parseControlPointResponse,
  requestControl as requestControlCommand,
  setTargetInclination,
  setTargetSpeed,
  startOrResume as startCommand,
  stop as stopCommand,
  type ControlPointResponse,
} from "./ftms/control-point";
import { parseFitnessMachineFeature } from "./ftms/features";
import { parseSupportedInclinationRange, parseSupportedSpeedRange } from "./ftms/ranges";
import { parseFitnessMachineStatus } from "./ftms/status";
import { parseTreadmillData } from "./ftms/treadmill-data";
import { emptyTreadmillSnapshot, TreadmillSource, type TreadmillSnapshot } from "./types";
import { DEVICE_INFORMATION_SERVICE, FITNESS_MACHINE_SERVICE, FTMS } from "./uuids";

/** How long to wait for the machine to indicate a control-point result. */
const CONTROL_RESPONSE_TIMEOUT_MS = 5_000;

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/**
 * Web Bluetooth requires a secure context. Chrome treats localhost as secure, so
 * plain-HTTP local development works while a LAN IP over HTTP does not.
 */
export function isSecureContextForBluetooth(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext;
}

/**
 * Talks to a real FTMS treadmill over GATT.
 *
 * Control-point traffic is request/response: the write only means "delivered",
 * and the machine reports acceptance or rejection through a separate indication.
 * Commands are therefore serialized and each one waits for its own answer, so a
 * rejected target speed surfaces as a rejection instead of appearing to work.
 */
export class WebBluetoothTreadmill extends TreadmillSource {
  private device?: BluetoothDevice;
  private controlPoint?: BluetoothRemoteGATTCharacteristic;

  /** Tail of the command queue, used to serialize control-point writes. */
  private commandChain: Promise<unknown> = Promise.resolve();

  private pending?: {
    opCode: number;
    resolve: (response: ControlPointResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  constructor() {
    // Deliberately does not probe for Web Bluetooth here. The store is created
    // during server rendering too, and branching on `navigator` would give the
    // server and the client different first snapshots. Support is reported by the
    // UI after mount, and a connect attempt on an unsupported browser reports it
    // again.
    super(emptyTreadmillSnapshot("bluetooth"));
  }

  async connect(): Promise<void> {
    if (!isWebBluetoothAvailable()) {
      this.patch({
        connection: "unsupported",
        error: "This browser does not support Web Bluetooth.",
      });
      return;
    }

    try {
      this.patch({ connection: "requesting", error: undefined });

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FITNESS_MACHINE_SERVICE] }],
        optionalServices: [DEVICE_INFORMATION_SERVICE],
      });

      this.device = device;
      device.addEventListener("gattserverdisconnected", this.handleDisconnect);

      this.patch({
        connection: "connecting",
        deviceName: device.name ?? "Treadmill",
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not open a GATT connection to the treadmill.");

      const service = await server.getPrimaryService(FITNESS_MACHINE_SERVICE);

      await this.subscribeToTreadmillData(service);
      await this.subscribeToStatus(service);
      await this.subscribeToControlPoint(service);
      await this.readCapabilities(service);

      this.patch({ connection: "connected" });

      // Requesting control up front means the workout controls are live as soon
      // as the card turns green, rather than failing on the first press.
      await this.requestControl();
    } catch (error) {
      this.patch({
        connection: this.snapshot.connection === "requesting" ? "idle" : "error",
        error: describeBluetoothError(error),
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.failPending(new Error("Disconnected from the treadmill."));
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);

    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } finally {
      this.device = undefined;
      this.controlPoint = undefined;
      this.replaceSnapshot(emptyTreadmillSnapshot("bluetooth"));
    }
  }

  async requestControl(): Promise<void> {
    const response = await this.sendCommand(
      ControlOpCode.requestControl,
      requestControlCommand(),
    );
    this.patch({ hasControl: response.succeeded, lastMessage: response.message });
  }

  async start(): Promise<void> {
    await this.command(ControlOpCode.startOrResume, startCommand());
    this.patch({ machineState: "running" });
  }

  async pause(): Promise<void> {
    await this.command(ControlOpCode.stopOrPause, pauseCommand());
    this.patch({ machineState: "paused" });
  }

  async stop(): Promise<void> {
    await this.command(ControlOpCode.stopOrPause, stopCommand());
    this.patch({ machineState: "stopped" });
  }

  async setTargetSpeed(speedKph: number): Promise<void> {
    await this.command(ControlOpCode.setTargetSpeed, setTargetSpeed(speedKph));
  }

  async setTargetIncline(inclinePercent: number): Promise<void> {
    await this.command(ControlOpCode.setTargetInclination, setTargetInclination(inclinePercent));
  }

  private async subscribeToTreadmillData(service: BluetoothRemoteGATTService): Promise<void> {
    const characteristic = await service.getCharacteristic(FTMS.treadmillData);
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      try {
        this.patch({ data: parseTreadmillData(value), lastUpdateAt: Date.now() });
      } catch (error) {
        console.warn("Ignoring malformed Treadmill Data notification", error);
      }
    });
    await characteristic.startNotifications();
  }

  private async subscribeToStatus(service: BluetoothRemoteGATTService): Promise<void> {
    // Optional in the spec. A machine without it still works; the app just will
    // not notice console-initiated stops.
    try {
      const characteristic = await service.getCharacteristic(FTMS.status);
      characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (!value) return;

        try {
          const status = parseFitnessMachineStatus(value);
          this.patch({
            lastMessage: status.message,
            ...(status.state ? { machineState: status.state } : {}),
            ...(status.controlLost ? { hasControl: false } : {}),
          });
        } catch (error) {
          console.warn("Ignoring malformed Fitness Machine Status notification", error);
        }
      });
      await characteristic.startNotifications();
    } catch {
      console.info("Treadmill does not expose Fitness Machine Status");
    }
  }

  private async subscribeToControlPoint(service: BluetoothRemoteGATTService): Promise<void> {
    const characteristic = await service.getCharacteristic(FTMS.controlPoint);
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      this.resolvePending(value);
    });
    await characteristic.startNotifications();
    this.controlPoint = characteristic;
  }

  private async readCapabilities(service: BluetoothRemoteGATTService): Promise<void> {
    // Each of these is optional. Read them independently so one missing
    // characteristic does not cost us the others.
    await this.tryRead(service, FTMS.feature, (value) => {
      this.patch({ features: parseFitnessMachineFeature(value) });
    });
    await this.tryRead(service, FTMS.supportedSpeedRange, (value) => {
      this.patch({ speedRange: parseSupportedSpeedRange(value) });
    });
    await this.tryRead(service, FTMS.supportedInclinationRange, (value) => {
      this.patch({ inclineRange: parseSupportedInclinationRange(value) });
    });
  }

  private async tryRead(
    service: BluetoothRemoteGATTService,
    uuid: number,
    handle: (value: DataView) => void,
  ): Promise<void> {
    try {
      const characteristic = await service.getCharacteristic(uuid);
      handle(await characteristic.readValue());
    } catch (error) {
      console.info(`Treadmill did not provide characteristic 0x${uuid.toString(16)}`, error);
    }
  }

  /** Queues a command and reports a rejection as an error the UI can show. */
  private async command(opCode: number, payload: Uint8Array): Promise<ControlPointResponse> {
    const response = await this.sendCommand(opCode, payload);
    this.patch({ lastMessage: response.message });

    if (!response.succeeded) throw new Error(response.message);
    return response;
  }

  /**
   * Writes to the control point and waits for the matching indication.
   *
   * FTMS allows only one outstanding control-point procedure at a time, so
   * commands are chained rather than issued concurrently — a slider dragged
   * quickly would otherwise interleave writes and confuse the machine.
   */
  private sendCommand(opCode: number, payload: Uint8Array): Promise<ControlPointResponse> {
    const run = this.commandChain.then(
      () => this.writeAndAwaitResponse(opCode, payload),
      () => this.writeAndAwaitResponse(opCode, payload),
    );

    // Keep the chain alive even when this command fails.
    this.commandChain = run.catch(() => undefined);
    return run;
  }

  private async writeAndAwaitResponse(
    opCode: number,
    payload: Uint8Array,
  ): Promise<ControlPointResponse> {
    const characteristic = this.controlPoint;
    if (!characteristic) throw new Error("The treadmill is not connected.");

    const response = new Promise<ControlPointResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error("The treadmill did not answer the command in time."));
      }, CONTROL_RESPONSE_TIMEOUT_MS);

      this.pending = { opCode, resolve, reject, timer };
    });

    try {
      if (characteristic.writeValueWithResponse) {
        await characteristic.writeValueWithResponse(toArrayBuffer(payload));
      } else {
        await characteristic.writeValue(toArrayBuffer(payload));
      }
    } catch (error) {
      this.failPending(new Error(describeBluetoothError(error)));
      throw error;
    }

    return response;
  }

  private resolvePending(value: DataView): void {
    const pending = this.pending;

    let response: ControlPointResponse;
    try {
      response = parseControlPointResponse(value);
    } catch (error) {
      console.warn("Ignoring malformed Control Point indication", error);
      return;
    }

    if (!pending) {
      this.patch({ lastMessage: response.message });
      return;
    }

    // A stale indication for an earlier command would otherwise resolve the
    // wrong request, so mismatched op codes are dropped and the caller keeps
    // waiting for its own answer or times out.
    if (pending.opCode !== response.requestOpCode) {
      console.warn(
        `Control Point answered op code 0x${response.requestOpCode.toString(16)} while awaiting 0x${pending.opCode.toString(16)}`,
      );
      return;
    }

    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve(response);
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.reject(error);
  }

  private readonly handleDisconnect = (): void => {
    this.failPending(new Error("The treadmill disconnected."));
    this.controlPoint = undefined;
    this.patch({
      connection: "disconnected",
      hasControl: false,
      machineState: "unknown",
      error: "The treadmill disconnected. Reconnect to carry on.",
    });
  };

  private replaceSnapshot(next: TreadmillSnapshot): void {
    this.replace(next);
  }
}

/** Web Bluetooth writes reject a Uint8Array view; hand it a plain buffer. */
function toArrayBuffer(payload: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(payload.byteLength);
  new Uint8Array(copy).set(payload);
  return copy;
}

/**
 * Turns Web Bluetooth's DOMExceptions into copy a runner can act on. The raw
 * messages name GATT internals and do not say what to do next.
 */
export function describeBluetoothError(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong talking to the device.";

  switch (error.name) {
    case "NotFoundError":
      return "No device was selected. Make sure the device is on and in range, then try again.";
    case "SecurityError":
      return "The browser blocked Bluetooth access. Web Bluetooth needs a secure context (https or localhost).";
    case "NetworkError":
      return "The connection dropped. Move closer to the device and try again.";
    case "NotSupportedError":
      return "This device does not expose the services the app needs.";
    case "InvalidStateError":
      return "The Bluetooth adapter is not ready. Check that Bluetooth is switched on.";
    default:
      return error.message || "Something went wrong talking to the device.";
  }
}
