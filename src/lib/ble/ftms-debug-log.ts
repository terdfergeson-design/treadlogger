/**
 * Debug logger for the treadmill's FTMS Bluetooth connection.
 *
 * Captures a timestamped trace of the GATT lifecycle — requestDevice,
 * gatt.connect, service/characteristic discovery, each control-point
 * command and response, every Treadmill Data notification, and any
 * `gattserverdisconnected` event — so a connection problem with a
 * treadmill this app hasn't been tested against can be diagnosed from
 * what the device actually sent, instead of guessing from the outside.
 *
 * Off by default (see `isFtmsDebugLogEnabled`/`setFtmsDebugLogEnabled`):
 * logging only runs while a user has turned it on from the gear icon on
 * the treadmill card, so normal use pays no cost for it. The toggle and
 * the captured log are both local to the browser — nothing here is sent
 * anywhere; "download" saves a plain-text file the user can attach
 * wherever they're reporting the issue.
 */

const ENABLED_STORAGE_KEY = "treadlogger.ftms-debug-log-enabled";

interface LogEntry {
  /** Milliseconds since logging was last (re)started. */
  t: number;
  event: string;
  details?: string;
}

const MAX_ENTRIES = 5_000;
const entries: LogEntry[] = [];
let startedAt = Date.now();

const enabledListeners = new Set<() => void>();

export function isFtmsDebugLogEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_STORAGE_KEY) === "true";
  } catch {
    // Storage can be unavailable or blocked; default to off.
    return false;
  }
}

export function setFtmsDebugLogEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Not persisting is survivable; the toggle just won't stick across reloads.
  }

  if (enabled) {
    // Start each logging session's timestamps from zero rather than from
    // whenever the module first loaded, so a log turned on mid-session
    // reads as cleanly as one turned on from the start.
    startedAt = Date.now();
  }

  for (const listener of enabledListeners) listener();
}

export function subscribeFtmsDebugLogEnabled(listener: () => void): () => void {
  enabledListeners.add(listener);
  return () => {
    enabledListeners.delete(listener);
  };
}

export function logFtmsEvent(event: string, details?: Record<string, unknown>): void {
  if (!isFtmsDebugLogEnabled()) return;

  const t = Date.now() - startedAt;
  const detailText = details ? safeStringify(details) : undefined;

  entries.push({ t, event, details: detailText });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function getFtmsDebugLogText(): string {
  if (entries.length === 0) return "(no events captured yet)";

  return entries
    .map((e) => `+${String(e.t).padStart(8, " ")}ms  ${e.event}${e.details ? `  ${e.details}` : ""}`)
    .join("\n");
}

export function clearFtmsDebugLog(): void {
  entries.length = 0;
}

export function ftmsDebugLogEntryCount(): number {
  return entries.length;
}

/** Hands the captured log to the browser as a downloadable .txt file. */
export function downloadFtmsDebugLog(deviceName?: string): void {
  const text = getFtmsDebugLogText();
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const namePart = deviceName ? `-${slugify(deviceName)}` : "";
  const link = document.createElement("a");
  link.href = url;
  link.download = `treadmill-ble-debug-log${namePart}-${stamp}.txt`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can race the download in some browsers, so give the
  // navigation a moment to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Renders a DataView as space-separated hex bytes, for logging raw FTMS payloads. */
export function hexDump(value: DataView): string {
  const bytes: string[] = [];
  for (let i = 0; i < value.byteLength; i++) {
    bytes.push(value.getUint8(i).toString(16).padStart(2, "0"));
  }
  return bytes.join(" ");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function safeStringify(details: Record<string, unknown>): string {
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}
