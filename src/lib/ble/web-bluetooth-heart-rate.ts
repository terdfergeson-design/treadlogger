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

      measurement.addEventListener("characteristicvaluechanged", (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (!value) return;

        try {
          this.patch({
            measurement: parseHeartRateMeasurement(value),
            lastUpdateAt: Date.now(),
          });
        } catch (error) {
          console.warn("Ignoring malformed Heart Rate Measurement notification", error);
        }
      });

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
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);

    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } finally {
      this.device = undefined;
      this.replaceSnapshot(emptyHeartRateSnapshot("bluetooth"));
    }
  }

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

  private readonly handleDisconnect = (): void => {
    this.patch({
      connection: "disconnected",
      error: "The heart rate monitor disconnected. Reconnect to carry on logging.",
    });
  };

  private replaceSnapshot(next: HeartRateSnapshot): void {
    this.replace(next);
  }
}
