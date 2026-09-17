import type { WorkoutSnapshot } from "./session";

/**
 * Saves the workout in progress (or just-finished) to `localStorage` so an
 * accidental refresh — or a crashed tab — doesn't lose it.
 *
 * Only the raw recorded snapshot is stored, not the FIT bytes, screenshot or
 * share card: all three are already regenerated deterministically from the
 * snapshot (see `finishWorkout` and the recovery effect in
 * `workout-provider.tsx`), so there is nothing else worth persisting.
 *
 * Deliberately never cleared automatically — not on a timer, not once the
 * FIT file has been downloaded, not just because the workout finished. Only
 * an explicit "Clear" (`discardWorkout`) or starting the next workout
 * (`startWorkout`) removes it. A finished workout the runner hasn't
 * downloaded yet is exactly the case this exists to protect.
 */

const STORAGE_KEY = "treadlogger.saved-workout";

/** Whatever `fitActivityInputFromWorkout`'s `metadata` argument needs, plus
 *  the max-heart-rate setting used to bucket the recorded samples into
 *  zones, in order to rebuild an identical FIT file and summary after a
 *  reload. */
export interface SavedWorkoutMetadata {
  mode: "bluetooth" | "simulator";
  maxHeartRateBpm: number;
  treadmillName?: string;
  heartRateMonitorName?: string;
}

export interface SavedWorkout {
  snapshot: WorkoutSnapshot;
  metadata: SavedWorkoutMetadata;
  /** Epoch millis this was last written, shown in the recovery toast. */
  savedAt: number;
}

/** Persists the current workout. Silently a no-op before the workout has
 *  actually started (nothing worth recovering yet). */
export function saveWorkout(snapshot: WorkoutSnapshot, metadata: SavedWorkoutMetadata): void {
  if (snapshot.startedAt === undefined) return;

  const saved: SavedWorkout = { snapshot, metadata, savedAt: Date.now() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage can be full or blocked (private browsing, quota exceeded by a
    // very long run's sample log); the workout still lives in memory for the
    // rest of this tab's life, which is the same guarantee the app had
    // before this existed.
  }
}

/** Reads back whatever was last saved, or `null` if there's nothing (or it's
 *  corrupt, e.g. from an older, incompatible version of this shape). */
export function loadSavedWorkout(): SavedWorkout | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SavedWorkout;
    if (!parsed?.snapshot || parsed.snapshot.startedAt === undefined) return null;
    if (!Array.isArray(parsed.snapshot.samples)) return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Removes the saved workout. Call this only for the two cases that should
 * actually discard recorded data — the user clicking "Clear", and starting
 * the next workout — never automatically (not on read, not on download, not
 * on a timer, not on tab close).
 */
export function clearSavedWorkout(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — worst case the stale entry lingers and is overwritten
    // by the next saveWorkout instead.
  }
}
