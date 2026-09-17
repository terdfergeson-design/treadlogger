/**
 * TEMPORARY diagnostic logger for the heart rate strap's BLE reconnect bug.
 *
 * Captures a timestamped trace of every step of the GATT lifecycle —
 * requestDevice, gatt.connect, service/characteristic discovery,
 * startNotifications, each measurement notification, and every
 * `gattserverdisconnected` event — so a real reconnect failure can be
 * diagnosed from what actually happened on this hardware, instead of
 * guessing at Web Bluetooth timing from the outside.
 *
 * This is not meant to ship. Once the reconnect issue is diagnosed and
 * fixed, delete this file and its two call sites:
 *   - the `logHrEvent` calls in `web-bluetooth-heart-rate.ts`
 *   - the "Download BLE debug log" button in `heart-rate-card.tsx`
 */

interface LogEntry {
  /** Milliseconds since this module first loaded (i.e. since page load). */
  t: number;
  event: string;
  details?: string;
}

const MAX_ENTRIES = 5_000;
const entries: LogEntry[] = [];
const startedAt = Date.now();

export function logHrEvent(event: string, details?: Record<string, unknown>): void {
  const t = Date.now() - startedAt;
  const detailText = details ? safeStringify(details) : undefined;

  entries.push({ t, event, details: detailText });
  if (entries.length > MAX_ENTRIES) entries.shift();

  console.log(`[HR-DEBUG +${t}ms] ${event}`, details ?? "");
}

export function getHrDebugLogText(): string {
  if (entries.length === 0) return "(no events captured yet)";

  return entries
    .map((e) => `+${String(e.t).padStart(8, " ")}ms  ${e.event}${e.details ? `  ${e.details}` : ""}`)
    .join("\n");
}

export function clearHrDebugLog(): void {
  entries.length = 0;
}

/** Hands the captured log to the browser as a downloadable .txt file. */
export function downloadHrDebugLog(): void {
  const text = getHrDebugLogText();
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");
  link.href = url;
  link.download = `hr-debug-log-${stamp}.txt`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can race the download in some browsers, so give the
  // navigation a moment to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function safeStringify(details: Record<string, unknown>): string {
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}
