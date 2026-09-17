import { parseBodySensorLocation, parseHeartRateMeasurement } from "./hr/measurement";
import { emptyHeartRateSnapshot, HeartRateSource, type HeartRateSnapshot } from "./types";
import { BATTERY_LEVEL_CHARACTERISTIC, BATTERY_SERVICE, HEART_RATE_SERVICE, HRS } from "./uuids";
import { describeBluetoothError, isWebBluetoothAvailable } from "./web-bluetooth-treadmill";

/**
 * Reads a BLE chest strap over the standard Heart Rate Service.
 *
 * Straps are a separate GATT connection from the treadmill and each needs its own
 * chooser prompt, since Web Bluetooth grants access one device per user gesture.
 */
export class WebBluetoothHeartRate extends HeartRateSource {
  private device?: BluetoothDevice;

  /**
   * Tracked so a reconnect can remove its listener before attaching a new
   * one. Web Bluetooth reuses the same characteristic object across
   * reconnects to the same device, so without this, every `connect()` call
   * stacked another listener on top of the last instead of replacing it —
   * confirmed by a captured debug log where a stale listener from a
   * previous connection delivered a measurement notification before the
   * current attempt had even finished discovering the service.
   */
  private measurementCharacteristic?: BluetoothRemoteGATTCharacteristic;

  constructor() {
    // See WebBluetoothTreadmill: support is not probed here so that the first
    // snapshot matches between server rendering and hydration.
    super(emptyHeartRateSnapshot("bluetooth"));
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
        filters: [{ services: [HEART_RATE_SERVICE] }],
        optionalServices: [BATTERY_SERVICE],
      });

      this.detachListeners();
      this.device = device;
      device.addEventListener("gattserverdisconnected", this.handleDisconnect);

      this.patch({
        connection: "connecting",
        deviceName: device.name ?? "Heart rate monitor",
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error("Could not open a GATT connection to the heart rate monitor.");

      const service = await server.getPrimaryService(HEART_RATE_SERVICE);
      const measurement = await service.getCharacteristic(HRS.measurement);

      // See `measurementCharacteristic` above: drop any listener left over
      // from a previous connection before attaching this one.
      this.measurementCharacteristic?.removeEventListener(
        "characteristicvaluechanged",
        this.handleMeasurement,
      );
      measurement.addEventListener("characteristicvaluechanged", this.handleMeasurement);
      this.measurementCharacteristic = measurement;

      await measurement.startNotifications();

      this.patch({ connection: "connected" });

      // Both are optional extras; failure to read them must not break the link.
      await this.readOptionalDetails(server, service);
    } catch (error) {
      this.patch({
        connection: this.snapshot.connection === "requesting" ? "idle" : "error",
        error: describeBluetoothError(error),
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.detachListeners();

    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } finally {
      this.device = undefined;
      this.replaceSnapshot(emptyHeartRateSnapshot("bluetooth"));
    }
  }

  // NOTE: a `device.forget()` call was tried here (revoking permission on
  // every disconnect, so the next connect() starts from a fresh pairing) to
  // work around a captured pattern where every reconnect after the first
  // completed service discovery successfully but never delivered data. It
  // made things worse — connecting stopped working at all afterward — so
  // it's reverted. Left as a note rather than silence, since it's a
  // reasonable-looking idea that turned out not to be safe on this
  // hardware/OS combination; don't reintroduce it without new evidence.

  /**
   * Removes both listeners this class attaches to the device. Called on
   * every disconnect — manual or automatic — rather than only at the start
   * of the next `connect()`, so a stale listener from a dead connection
   * can't still be attached (and still firing) during the gap before the
   * next attempt. That gap is exactly where a captured debug log caught one
   * doing so: a measurement notification arrived before the *next* attempt
   * had even finished discovering the service, because the previous
   * attempt's listener was still live.
   */
  private detachListeners(): void {
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    this.measurementCharacteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.handleMeasurement,
    );
    this.measurementCharacteristic = undefined;
  }

  private readonly handleMeasurement = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;

    try {
      const parsed = parseHeartRateMeasurement(value);
      this.patch({ measurement: parsed, lastUpdateAt: Date.now() });
    } catch (error) {
      console.warn("Ignoring malformed Heart Rate Measurement notification", error);
    }
  };

  private async readOptionalDetails(
    server: BluetoothRemoteGATTServer,
    service: BluetoothRemoteGATTService,
  ): Promise<void> {
    try {
      const location = await service.getCharacteristic(HRS.bodySensorLocation);
      this.patch({ bodySensorLocation: parseBodySensorLocation(await location.readValue()) });
    } catch {
      // Straps commonly omit this.
    }

    try {
      const battery = await server.getPrimaryService(BATTERY_SERVICE);
      const level = await battery.getCharacteristic(BATTERY_LEVEL_CHARACTERISTIC);
      this.patch({ batteryPercent: (await level.readValue()).getUint8(0) });
    } catch {
      // Battery Service is not guaranteed, and is not requestable unless it was
      // listed in optionalServices at pairing time.
    }
  }

  /**
   * No automatic retry loop here, and no `device.forget()` either — see the
   * NOTE above `disconnect()` and git history / conversation for three
   * earlier attempts at fixing reconnect (a background retry loop, twice,
   * and a forget-on-disconnect), each of which made things worse on real
   * hardware. Reconnect stays a plain, manual, explicit action (re-clicking
   * "Pair heart rate monitor").
   *
   * The stale measurement/battery/sensor-location fields are cleared
   * immediately on disconnect, rather than left in the snapshot. Previously,
   * if a reconnect attempt ever got `connection` back to "connected" even
   * briefly, the card would show the heart rate from *before* the drop as if
   * it were live, since that field was never wiped.
   */
  private readonly handleDisconnect = (): void => {
    // Detach now rather than waiting for the next connect() attempt to do
    // it — see `detachListeners` above for why that gap mattered.
    this.detachListeners();

    this.patch({
      connection: "disconnected",
      error: "The heart rate monitor disconnected. Reconnect to carry on logging.",
      measurement: undefined,
      lastUpdateAt: undefined,
      bodySensorLocation: undefined,
      batteryPercent: undefined,
    });
  };

  private replaceSnapshot(next: HeartRateSnapshot): void {
    this.replace(next);
  }
}
