/** Display formatting for workout metrics. */

import {
  KM_PER_MILE,
  toMachineSpeed,
  type MachineSpeedUnit,
} from "./ble/ftms/speed-units";

/** Renders seconds as `M:SS`, or `H:MM:SS` once the workout passes an hour. */
export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  const pad = (value: number) => value.toString().padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Metres below a kilometre, kilometres above it. */
export function formatDistance(metres: number): { value: string; unit: string } {
  if (!Number.isFinite(metres) || metres < 0) return { value: "0", unit: "m" };
  if (metres < 1000) return { value: Math.round(metres).toString(), unit: "m" };
  return { value: (metres / 1000).toFixed(2), unit: "km" };
}

/**
 * Speeds and paces are held in km/h everywhere above the GATT boundary, but they
 * are shown in the unit the treadmill itself uses: a runner reading 3.2 off a
 * mph machine's console needs the card to say 3.2 mph, not 5.1 km/h.
 */
export function speedUnitLabel(unit: MachineSpeedUnit = "kph"): string {
  return unit === "mph" ? "mph" : "km/h";
}

export function paceUnitLabel(unit: MachineSpeedUnit = "kph"): string {
  return unit === "mph" ? "/mi" : "/km";
}

export function formatSpeed(
  speedKph: number | undefined,
  unit: MachineSpeedUnit = "kph",
): string {
  if (speedKph === undefined || !Number.isFinite(speedKph)) return "0.0";
  return toMachineSpeed(speedKph, unit).toFixed(1);
}

/**
 * Renders a pace as `M:SS`, per kilometre or per mile to match the speed unit.
 * An em dash means no pace yet.
 */
export function formatPace(
  minutesPerKm: number | undefined,
  unit: MachineSpeedUnit = "kph",
): string {
  if (minutesPerKm === undefined || !Number.isFinite(minutesPerKm) || minutesPerKm <= 0) {
    return "—";
  }

  // Minutes per mile is minutes per kilometre over the miles in a kilometre,
  // which is the same conversion the speed takes, the other way up.
  const pace = unit === "mph" ? minutesPerKm * KM_PER_MILE : minutesPerKm;

  // A pace slower than this is a standstill in practice, and the readout would
  // otherwise churn through implausible numbers as the belt spins down.
  if (pace > 99) return "—";

  const minutes = Math.floor(pace);
  const seconds = Math.round((pace - minutes) * 60);

  return seconds === 60
    ? `${minutes + 1}:00`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatIncline(inclinePercent: number | undefined): string {
  if (inclinePercent === undefined || !Number.isFinite(inclinePercent)) return "0.0";
  return inclinePercent.toFixed(1);
}

export function formatHeartRate(bpm: number | undefined): string {
  if (bpm === undefined || !Number.isFinite(bpm) || bpm <= 0) return "—";
  return Math.round(bpm).toString();
}

export function formatCalories(kcal: number): string {
  if (!Number.isFinite(kcal) || kcal <= 0) return "0";
  return Math.round(kcal).toString();
}

/** Time of day, used on the summary card. */
export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
