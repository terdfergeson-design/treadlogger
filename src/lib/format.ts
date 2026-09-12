/** Display formatting for workout metrics. */

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

export function formatSpeed(speedKph: number | undefined): string {
  if (speedKph === undefined || !Number.isFinite(speedKph)) return "0.0";
  return speedKph.toFixed(1);
}

/** Renders minutes per kilometre as `M:SS`. An em dash means no pace yet. */
export function formatPace(minutesPerKm: number | undefined): string {
  if (minutesPerKm === undefined || !Number.isFinite(minutesPerKm) || minutesPerKm <= 0) {
    return "—";
  }
  // A pace slower than this is a standstill in practice, and the readout would
  // otherwise churn through implausible numbers as the belt spins down.
  if (minutesPerKm > 99) return "—";

  const minutes = Math.floor(minutesPerKm);
  const seconds = Math.round((minutesPerKm - minutes) * 60);

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
