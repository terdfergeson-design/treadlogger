import { useCallback, useSyncExternalStore } from "react";

import {
  isFtmsDebugLogEnabled,
  setFtmsDebugLogEnabled,
  subscribeFtmsDebugLogEnabled,
} from "@/lib/ble/ftms-debug-log";

/**
 * Persisted on/off switch for the treadmill's Bluetooth debug log (see
 * `lib/ble/ftms-debug-log.ts`). Off by default; toggled from the gear icon
 * on the treadmill card.
 *
 * Reading `localStorage` while rendering on the server is impossible, so
 * this goes through `useSyncExternalStore` with `false` as the server
 * snapshot, the same pattern as the machine speed unit preferences.
 */
export function useFtmsDebugLogEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribeFtmsDebugLogEnabled,
    isFtmsDebugLogEnabled,
    () => false,
  );
  const setEnabled = useCallback((next: boolean) => setFtmsDebugLogEnabled(next), []);
  return [enabled, setEnabled];
}
