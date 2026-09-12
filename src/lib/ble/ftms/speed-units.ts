/**
 * The unit a treadmill actually puts in the FTMS speed fields.
 *
 * FTMS defines every speed field — Instantaneous and Average Speed in Treadmill
 * Data (0x2ACD), the Set Target Speed parameter (0x2AD9), Supported Speed Range
 * (0x2AD4) and the Target Speed Changed status (0x2ADA) — as a uint16 in
 * kilometres per hour at 0.01 resolution. Some machines, typically firmware
 * written for a mph console, put miles per hour in those same fields at the same
 * resolution and never say so.
 *
 * On such a machine the numbers still look plausible, so nothing errors: ask for
 * 3.5 and the belt runs 3.5 mph, which is 5.63 km/h. Every commanded speed comes
 * out a factor of 1.609 fast and the reported speed reads a factor of 1.609
 * slow, in opposite directions, which is why the two never agree.
 *
 * The unit is therefore a property of the machine, declared once and applied at
 * every point where a speed crosses the GATT boundary. Above that boundary the
 * whole app is kilometres per hour and knows nothing about this.
 */

export type MachineSpeedUnit = "kph" | "mph";

/** The international mile, exactly 1609.344 m, so the factor is exact. */
export const KM_PER_MILE = 1.609344;

export const MACHINE_SPEED_UNITS: readonly MachineSpeedUnit[] = ["kph", "mph"];

/** Per-unit copy for the settings control. */
export const MACHINE_SPEED_UNIT_LABELS: Record<MachineSpeedUnit, string> = {
  kph: "km/h",
  mph: "mph",
};

export const DEFAULT_MACHINE_SPEED_UNIT: MachineSpeedUnit = "kph";

/** Converts km/h into the value to write to the machine. */
export function toMachineSpeed(speedKph: number, unit: MachineSpeedUnit): number {
  return unit === "mph" ? speedKph / KM_PER_MILE : speedKph;
}

/** Converts a value read from the machine into km/h. */
export function fromMachineSpeed(speed: number, unit: MachineSpeedUnit): number {
  return unit === "mph" ? speed * KM_PER_MILE : speed;
}

export function isMachineSpeedUnit(value: unknown): value is MachineSpeedUnit {
  return value === "kph" || value === "mph";
}
