import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_MACHINE_SPEED_UNIT,
  isMachineSpeedUnit,
  type MachineSpeedUnit,
} from "@/lib/ble/ftms/speed-units";

/**
 * The connected treadmill's speed unit, remembered across reloads.
 *
 * It describes the machine in the room rather than a preference about this
 * session, so it is persisted. Reading `localStorage` while rendering on the
 * server is impossible, so this goes through `useSyncExternalStore` with the
 * spec default as the server snapshot — the same shape as the Bluetooth support
 * probe, and it avoids both a hydration mismatch and a setState-in-effect.
 */
const STORAGE_KEY = "treadlink.machine-speed-unit";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): MachineSpeedUnit {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isMachineSpeedUnit(stored) ? stored : DEFAULT_MACHINE_SPEED_UNIT;
  } catch {
    // Storage can be unavailable or blocked; the spec default still works.
    return DEFAULT_MACHINE_SPEED_UNIT;
  }
}

function write(unit: MachineSpeedUnit): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    // Not persisting is survivable; the rest of the session still honours it.
  }
  for (const listener of listeners) listener();
}

export function useMachineSpeedUnit(): [MachineSpeedUnit, (unit: MachineSpeedUnit) => void] {
  const unit = useSyncExternalStore(subscribe, read, () => DEFAULT_MACHINE_SPEED_UNIT);
  const setUnit = useCallback((next: MachineSpeedUnit) => write(next), []);

  return [unit, setUnit];
}
