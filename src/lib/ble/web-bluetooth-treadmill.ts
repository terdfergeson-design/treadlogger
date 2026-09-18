import { hexDump, logFtmsEvent } from "./ftms-debug-log";
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
import {
  DEFAULT_MACHINE_SPEED_UNIT,
  type MachineSpeedUnit,
} from "./ftms/speed-units";
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
 *
 * Every step below also calls `logFtmsEvent` (see `./ftms-debug-log`), which is
 * a no-op unless a user has turned on the "Enable debug log" switch behind the
 * gear icon on the treadmill card. It exists to diagnose a treadmill this app
 * hasn't been tested against — different firmware can omit characteristics,
 * encode fields differently, or answer control-point commands unexpectedly,
 * and a captured trace of what actually happened beats guessing from a bug
 * report alone.
 */
export class WebBluetoothTreadmill extends TreadmillSource {
  private device?: BluetoothDevice;
  private controlPoint?: BluetoothRemoteGATTCharacteristic;

  /**
   * Supported Speed Range as the machine sent it. Kept so the bounds can be
   * re-derived when the machine's speed unit is corrected mid-session, which is
   * cheaper and more reliable than re-reading the characteristic.
   */
  private rawSpeedRange?: Uint8Array;

  /** Tail of the command queue, used to serialize control-point writes. */
  private commandChain: Promise<unknown> = Promise.resolve();

  private pending?: {
    opCode: number;
    resolve: (response: ControlPointResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  constructor(
    speedUnit: MachineSpeedUnit = DEFAULT_MACHINE_SPEED_UNIT,
    commandSpeedUnit: MachineSpeedUnit = DEFAULT_MACHINE_SPEED_UNIT,
  ) {
    // Deliberately does not probe for Web Bluetooth here. The store is created
    // during server rendering too, and branching on `navigator` would give the
    // server and the client different first snapshots. Support is reported by the
    // UI after mount, and a connect attempt on an unsupported browser reports it
    // again.
    super(emptyTreadmillSnapshot("bluetooth"));
    this.speedUnit = speedUnit;
    this.commandSpeedUnit = commandSpeedUnit;
  }

  override setCommandSpeedUnit(unit: MachineSpeedUnit): void {
    super.setCommandSpeedUnit(unit);
    // Supported Speed Range bounds the Control Point, not Treadmill Data, so
    // it is re-derived here rather than from `setSpeedUnit`.
    if (this.rawSpeedRange) {
      this.patch({ speedRange: parseSupportedSpeedRange(this.rawSpeedRange, unit) });
    }
  }

  async connect(): Promise<void> {
    if (!isWebBluetoothAvailable()) {
      logFtmsEvent("connect:unsupported");
      this.patch({
        connection: "unsupported",
        error: "This browser does not support Web Bluetooth.",
      });
      return;
    }

    logFtmsEvent("requestDevice:start");
    try {
      this.patch({ connection: "requesting", error: undefined });

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FITNESS_MACHINE_SERVICE] }],
        optionalServices: [DEVICE_INFORMATION_SERVICE],
      });
      logFtmsEvent("requestDevice:resolved", { name: device.name, id: device.id });

      this.device = device;
      device.addEventListener("gattserverdisconnected", this.handleDisconnect);

      this.patch({
        connection: "connecting",
        deviceName: device.name ?? "Treadmill",
      });

      logFtmsEvent("gatt.connect:start");
      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not open a GATT connection to the treadmill.");
      logFtmsEvent("gatt.connect:resolved");

      const service = await server.getPrimaryService(FITNESS_MACHINE_SERVICE);
      logFtmsEvent("getPrimaryService:resolved", { service: FITNESS_MACHINE_SERVICE.toString() });

      await this.subscribeToTreadmillData(service);
      await this.subscribeToStatus(service);
      await this.subscribeToControlPoint(service);
      await this.readCapabilities(service);

      logFtmsEvent("connect:connected");
      this.patch({ connection: "connected" });

      // Requesting control up front means the workout controls are live as soon
      // as the card turns green, rather than failing on the first press.
      await this.requestControl();
    } catch (error) {
      const message = describeBluetoothError(error);
      logFtmsEvent("connect:error", { message, name: error instanceof Error ? error.name : undefined });
      this.patch({
        connection: this.snapshot.connection === "requesting" ? "idle" : "error",
        error: message,
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    logFtmsEvent("disconnect:manual");
    this.failPending(new Error("Disconnected from the treadmill."));
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);

    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } finally {
      this.device = undefined;
      this.controlPoint = undefined;
      this.rawSpeedRange = undefined;
      this.replaceSnapshot(emptyTreadmillSnapshot("bluetooth"));
    }
  }

  async requestControl(): Promise<void> {
    logFtmsEvent("requestControl:start");
    const response = await this.sendCommand(
      ControlOpCode.requestControl,
      requestControlCommand(),
    );
    logFtmsEvent("requestControl:response", {
      succeeded: response.succeeded,
      message: response.message,
    });
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
    await this.command(
      ControlOpCode.setTargetSpeed,
      setTargetSpeed(speedKph, this.commandSpeedUnit),
    );
  }

  async setTargetIncline(inclinePercent: number): Promise<void> {
    await this.command(ControlOpCode.setTargetInclination, setTargetInclination(inclinePercent));
  }

  private async subscribeToTreadmillData(service: BluetoothRemoteGATTService): Promise<void> {
    const characteristic = await service.getCharacteristic(FTMS.treadmillData);
    logFtmsEvent("treadmillData:characteristic-found");
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;

      try {
        const parsed = parseTreadmillData(value, this.speedUnit);
        logFtmsEvent("treadmillData:notification", { raw: hexDump(value), parsed });
        this.mergeTreadmillData(parsed, Date.now());
      } catch (error) {
        logFtmsEvent("treadmillData:malformed", { raw: hexDump(value) });
        console.warn("Ignoring malformed Treadmill Data notification", error);
      }
    });
    await characteristic.startNotifications();
    logFtmsEvent("treadmillData:notifications-started");
  }

  private async subscribeToStatus(service: BluetoothRemoteGATTService): Promise<void> {
    // Optional in the spec. A machine without it still works; the app just will
    // not notice console-initiated stops.
    try {
      const characteristic = await service.getCharacteristic(FTMS.status);
      logFtmsEvent("status:characteristic-found");
      characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (!value) return;

        try {
          // "Target speed changed" describes the same Control Point value as
          // Set Target Speed, so it uses the command unit, not the readout one.
          const status = parseFitnessMachineStatus(value, this.commandSpeedUnit);
          logFtmsEvent("status:notification", { raw: hexDump(value), status });
          this.patch({
            lastMessage: status.message,
            ...(status.state ? { machineState: status.state } : {}),
            ...(status.controlLost ? { hasControl: false } : {}),
          });
        } catch (error) {
          logFtmsEvent("status:malformed", { raw: hexDump(value) });
          console.warn("Ignoring malformed Fitness Machine Status notification", error);
        }
      });
      await characteristic.startNotifications();
      logFtmsEvent("status:notifications-started");
    } catch {
      logFtmsEvent("status:not-present");
      console.info("Treadmill does not expose Fitness Machine Status");
    }
  }

  private async subscribeToControlPoint(service: BluetoothRemoteGATTService): Promise<void> {
    const characteristic = await service.getCharacteristic(FTMS.controlPoint);
    logFtmsEvent("controlPoint:characteristic-found");
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      logFtmsEvent("controlPoint:indication", { raw: hexDump(value) });
      this.resolvePending(value);
    });
    await characteristic.startNotifications();
    logFtmsEvent("controlPoint:notifications-started");
    this.controlPoint = characteristic;
  }

  private async readCapabilities(service: BluetoothRemoteGATTService): Promise<void> {
    // Each of these is optional. Read them independently so one missing
    // characteristic does not cost us the others.
    await this.tryRead(service, FTMS.feature, (value) => {
      const features = parseFitnessMachineFeature(value);
      logFtmsEvent("feature:read", { raw: hexDump(value), features });
      this.patch({ features });
    });
    await this.tryRead(service, FTMS.supportedSpeedRange, (value) => {
      this.rawSpeedRange = new Uint8Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      );
      // Bounds the Control Point's Set Target Speed parameter, so it is read
      // in the command unit, not the Treadmill Data readout unit.
      const speedRange = parseSupportedSpeedRange(value, this.commandSpeedUnit);
      logFtmsEvent("supportedSpeedRange:read", { raw: hexDump(value), speedRange });
      this.patch({ speedRange });
    });
    await this.tryRead(service, FTMS.supportedInclinationRange, (value) => {
      const inclineRange = parseSupportedInclinationRange(value);
      logFtmsEvent("supportedInclinationRange:read", { raw: hexDump(value), inclineRange });
      this.patch({ inclineRange });
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
      logFtmsEvent("characteristic:not-present", { uuid: `0x${uuid.toString(16)}` });
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

    logFtmsEvent("controlPoint:write", { opCode: `0x${opCode.toString(16)}`, payload: hexToString(payload) });

    const response = new Promise<ControlPointResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        logFtmsEvent("controlPoint:timeout", { opCode: `0x${opCode.toString(16)}` });
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
      const message = describeBluetoothError(error);
      logFtmsEvent("controlPoint:write-error", { opCode: `0x${opCode.toString(16)}`, message });
      this.failPending(new Error(message));
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
      logFtmsEvent("controlPoint:malformed-response", { raw: hexDump(value) });
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
      logFtmsEvent("controlPoint:opcode-mismatch", {
        expected: `0x${pending.opCode.toString(16)}`,
        got: `0x${response.requestOpCode.toString(16)}`,
      });
      console.warn(
        `Control Point answered op code 0x${response.requestOpCode.toString(16)} while awaiting 0x${pending.opCode.toString(16)}`,
      );
      return;
    }

    logFtmsEvent("controlPoint:response", {
      opCode: `0x${response.requestOpCode.toString(16)}`,
      succeeded: response.succeeded,
      message: response.message,
    });
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
    logFtmsEvent("disconnect:gattserverdisconnected");
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

/** Renders a write payload as hex for the debug log, without a DataView wrapper. */
function hexToString(payload: Uint8Array): string {
  return Array.from(payload)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
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
