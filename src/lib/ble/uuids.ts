/**
 * Bluetooth SIG assigned numbers for the services this app speaks.
 *
 * Web Bluetooth accepts 16-bit shorthand for SIG-assigned UUIDs, but comparing
 * values coming back from the browser requires the expanded 128-bit form, so
 * both are kept here.
 */

export const FITNESS_MACHINE_SERVICE = 0x1826;
export const HEART_RATE_SERVICE = 0x180d;
export const DEVICE_INFORMATION_SERVICE = 0x180a;
export const BATTERY_SERVICE = 0x180f;

/** Characteristics of the Fitness Machine Service (FTMS). */
export const FTMS = {
  /** Fitness Machine Feature — read. Two 32-bit bitfields. */
  feature: 0x2acc,
  /** Treadmill Data — notify. Flags-driven variable layout. */
  treadmillData: 0x2acd,
  /** Supported Speed Range — read. min / max / increment. */
  supportedSpeedRange: 0x2ad4,
  /** Supported Inclination Range — read. min / max / increment. */
  supportedInclinationRange: 0x2ad5,
  /** Fitness Machine Control Point — write + indicate. */
  controlPoint: 0x2ad9,
  /** Fitness Machine Status — notify. Machine-initiated state changes. */
  status: 0x2ada,
} as const;

/** Characteristics of the Heart Rate Service. */
export const HRS = {
  /** Heart Rate Measurement — notify. */
  measurement: 0x2a37,
  /** Body Sensor Location — read. */
  bodySensorLocation: 0x2a38,
} as const;

export const BATTERY_LEVEL_CHARACTERISTIC = 0x2a19;

/** Expands a 16-bit SIG-assigned number into its full 128-bit UUID string. */
export function toFullUuid(shortUuid: number): string {
  return `${shortUuid.toString(16).padStart(8, "0")}-0000-1000-8000-00805f9b34fb`;
}
