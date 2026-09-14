import { useCallback, useSyncExternalStore } from "react";

import { isMachineSpeedUnit, type MachineSpeedUnit } from "@/lib/ble/ftms/speed-units";

/**
 * Persisted per-machine speed-unit preferences.
 *
 * These describe the machine in the room rather than a preference about this
 * session, so each is remembered across reloads. There are two of them,
 * deliberately independent (see the doc comments on `TreadmillSource.speedUnit`
 * and `.commandSpeedUnit` in `lib/ble/types.ts` for the full reasoning): real
 * hardware has turned up where the Treadmill Data readout is spec-compliant
 * km/h but the Control Point's target-speed field is read as mph regardless —
 * different firmware paths, apparently written with different assumptions. A
 * single shared toggle can only ever get one of those two right, which is why
 * they also default differently (see below) rather than sharing one constant.
 *
 * Reading `localStorage` while rendering on the server is impossible, so each
 * hook goes through `useSyncExternalStore` with its own default as the server
 * snapshot — the same shape as the Bluetooth support probe, and it avoids
 * both a hydration mismatch and a setState-in-effect.
 */

/**
 * The readout default mirrors `DEFAULT_MACHINE_SPEED_UNIT` in
 * `speed-units.ts`: "kph", the spec-compliant assumption. It briefly
 * defaulted to "mph" on the theory that most machines runners connect here
 * have mph consoles and non-compliant firmware to match — but a real device
 * test showed the opposite: a machine whose Treadmill Data readout genuinely
 * carries km/h per spec, which on the "mph" default over-reported speed by
 * exactly the km/h-to-mph factor (0.5 mph read back as 0.8, 4.8 as 7.7).
 */
const DEFAULT_READOUT_SPEED_UNIT: MachineSpeedUnit = "kph";

/**
 * The command default is "mph" — deliberately the opposite of the readout
 * default above. This app's own treadmill was confirmed, by commanding 1 mph
 * and 2 mph and watching the belt actually settle at ~1.5 and ~3.2 (both
 * ~1.609x too fast, the km/h-to-mph factor), to have a Control Point that
 * reads its target-speed parameter as mph regardless of what the spec says —
 * the asymmetric-firmware case the two-toggle split above exists for. Since
 * this is the machine the app is built around, "mph" is the out-of-the-box
 * default here; anyone connecting a different, spec-compliant machine can
 * still switch it back to kph from the settings popover.
 */
const DEFAULT_COMMAND_SPEED_UNIT: MachineSpeedUnit = "mph";

/**
 * Builds an independent persisted speed-unit preference: its own storage key,
 * its own default, its own listener set, so the readout and command units
 * never share state.
 */
function createPersistedSpeedUnit(
  storageKey: string,
  defaultUnit: MachineSpeedUnit,
): () => [MachineSpeedUnit, (unit: MachineSpeedUnit) => void] {
  const listeners = new Set<() => void>();

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function read(): MachineSpeedUnit {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return isMachineSpeedUnit(stored) ? stored : defaultUnit;
    } catch {
      // Storage can be unavailable or blocked; the default still works.
      return defaultUnit;
    }
  }

  function write(unit: MachineSpeedUnit): void {
    try {
      window.localStorage.setItem(storageKey, unit);
    } catch {
      // Not persisting is survivable; the rest of the session still honours it.
    }
    for (const listener of listeners) listener();
  }

  return function usePersistedSpeedUnit(): [MachineSpeedUnit, (unit: MachineSpeedUnit) => void] {
    const unit = useSyncExternalStore(subscribe, read, () => defaultUnit);
    const setUnit = useCallback((next: MachineSpeedUnit) => write(next), []);
    return [unit, setUnit];
  };
}

/** The unit the connected machine's Treadmill Data notifications use. */
export const useMachineSpeedUnit = createPersistedSpeedUnit(
  "treadlogger.machine-speed-unit",
  DEFAULT_READOUT_SPEED_UNIT,
);

/**
 * The unit the connected machine's Control Point actually reads target speed
 * as (and, by extension, its Supported Speed Range and status target-speed
 * fields — see `lib/ble/types.ts`).
 */
export const useCommandSpeedUnit = createPersistedSpeedUnit(
  "treadlogger.command-speed-unit",
  DEFAULT_COMMAND_SPEED_UNIT,
);
