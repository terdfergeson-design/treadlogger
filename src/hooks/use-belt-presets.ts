import { useCallback, useSyncExternalStore } from "react";

/**
 * Quick-dial presets for the belt control card: a runner taps one of these
 * instead of dialing a slider. Speed and incline are deliberately separate
 * lists — a speed preset only ever changes speed, an incline preset only
 * ever changes incline — rather than one button setting both, since the two
 * controls are gated differently (see `treadmill-controls.tsx`: speed is
 * locked until the workout starts, incline isn't).
 *
 * Speed presets are stored in mph — this app's display unit — so the button
 * labels and the settings inputs never need a conversion; it's converted to
 * km/h only at the moment a preset is applied, the same way the speed slider
 * does.
 */

export const SPEED_PRESET_COUNT = 9;
export const INCLINE_PRESET_COUNT = 6;

/**
 * Sane storage-time ceilings, independent of whatever treadmill happens to
 * be connected — the actual connected machine's speed/incline range is
 * enforced again (and authoritatively) by `setTargetSpeed`/`setTargetIncline`
 * in `workout-provider.tsx` when a preset is applied. These just keep the
 * settings UI from storing something nonsensical for a machine that isn't
 * connected yet. Floor is always 0 for both.
 */
const MAX_SPEED_PRESET_MPH = 20;
const MAX_INCLINE_PRESET_PERCENT = 40;

/** A walk-to-run ladder, three rows of three. */
const DEFAULT_SPEED_PRESETS_MPH: readonly number[] = [0.5, 3, 5, 5.5, 6, 6.5, 7, 7.5, 8];

/** 0% through 5%, one per percentage point, two rows of three. */
const DEFAULT_INCLINE_PRESETS_PERCENT: readonly number[] = [0, 1, 2, 3, 4, 5];

export interface PersistedPresetList {
  values: number[];
  /** Updates one preset by its index. */
  setValue: (index: number, value: number) => void;
  reset: () => void;
}

/**
 * Builds an independent persisted list of numeric presets: its own storage
 * key, its own defaults, its own listener set — mirrors the factory in
 * `use-machine-speed-unit.ts`. The cache is populated lazily (on first
 * client-side `getSnapshot` call, not at module load) so this module never
 * touches `localStorage` while rendering on the server.
 */
function createPersistedPresetList(
  storageKey: string,
  defaults: readonly number[],
  maxValue: number,
): () => PersistedPresetList {
  const listeners = new Set<() => void>();
  let cache: number[] | null = null;

  const defaultValues = (): number[] => defaults.slice();
  const clamp = (value: number): number =>
    Number.isFinite(value) ? Math.min(maxValue, Math.max(0, value)) : 0;

  function isValidList(value: unknown): value is number[] {
    return (
      Array.isArray(value) &&
      value.length === defaults.length &&
      value.every((entry) => typeof entry === "number")
    );
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): number[] {
    if (cache) return cache;
    try {
      const stored = window.localStorage.getItem(storageKey);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      cache = isValidList(parsed) ? parsed.map(clamp) : defaultValues();
    } catch {
      cache = defaultValues();
    }
    return cache;
  }

  function getServerSnapshot(): number[] {
    return defaults as number[];
  }

  function persist(next: number[]): void {
    cache = next;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Not persisting is survivable; the rest of the session still uses it.
    }
    for (const listener of listeners) listener();
  }

  return function usePersistedPresetList(): PersistedPresetList {
    const values = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const setValue = useCallback((index: number, value: number) => {
      const current = getSnapshot();
      if (index < 0 || index >= current.length) return;
      const next = current.slice();
      next[index] = clamp(value);
      persist(next);
    }, []);

    const reset = useCallback(() => {
      persist(defaultValues());
    }, []);

    return { values, setValue, reset };
  };
}

/** Nine quick-dial speed presets (mph) — rendered as three rows of three. */
export const useSpeedPresets = createPersistedPresetList(
  "treadlogger.speed-presets",
  DEFAULT_SPEED_PRESETS_MPH,
  MAX_SPEED_PRESET_MPH,
);

/** Six quick-dial incline presets (%) — rendered as two rows of three. */
export const useInclinePresets = createPersistedPresetList(
  "treadlogger.incline-presets",
  DEFAULT_INCLINE_PRESETS_PERCENT,
  MAX_INCLINE_PRESET_PERCENT,
);
