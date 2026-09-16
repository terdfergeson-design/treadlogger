import { intervalWorkoutFileName, parseIntervalWorkoutFile, serializeIntervalWorkoutFile } from "./serialize";
import type { IntervalWorkoutFile } from "./types";

/**
 * Browser-side save/open for `.treadlogger.json` interval workout files.
 * Mirrors `lib/fit/download.ts`'s object-URL download, just with a text
 * blob instead of a binary one, and adds the read side FIT export doesn't
 * need (a recorded activity is never re-opened as an activity).
 */

/** Hands a workout to the browser as a downloadable `.treadlogger.json` file. */
export function downloadIntervalWorkoutFile(workout: IntervalWorkoutFile): void {
  const text = serializeIntervalWorkoutFile(workout);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = intervalWorkoutFileName(workout.name);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can race the download in some browsers, so give the
  // navigation a moment to start (same margin `fit/download.ts` uses).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Reads a `.treadlogger.json` file picked via an `<input type="file">` or
 * dropped onto the page. Rejects with `IntervalWorkoutFileError` (see
 * `serialize.ts`) if the file's contents don't parse — callers surface that
 * message directly, the same way `workout-provider.tsx`'s `guard()` toasts
 * a BLE failure, rather than swallowing it.
 */
export function readIntervalWorkoutFile(file: File): Promise<IntervalWorkoutFile> {
  return file.text().then(parseIntervalWorkoutFile);
}
