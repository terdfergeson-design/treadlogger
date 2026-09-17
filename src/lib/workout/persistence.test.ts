import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkoutSnapshot } from "./session";
import { clearSavedWorkout, loadSavedWorkout, saveWorkout, type SavedWorkoutMetadata } from "./persistence";

/**
 * The test environment runs Vitest under Node, not a browser, so `window`
 * doesn't exist by default. A minimal in-memory stand-in is enough — these
 * tests only exercise this module's own get/set/remove calls, not real
 * browser storage semantics (quotas, persistence across processes, etc.).
 */
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
}

const T0 = Date.UTC(2026, 0, 15, 7, 30, 0);

const snapshot = (overrides: Partial<WorkoutSnapshot> = {}): WorkoutSnapshot => ({
  state: "active",
  startedAt: T0,
  elapsedS: 30,
  totalElapsedS: 30,
  distanceM: 100,
  elevationGainM: 0,
  energyKcal: 10,
  speedKph: 10,
  avgSpeedKph: 10,
  maxSpeedKph: 10,
  maxInclinePercent: 0,
  timeInZones: {},
  samples: [],
  ...overrides,
});

const metadata: SavedWorkoutMetadata = { mode: "simulator", maxHeartRateBpm: 190 };

describe("workout persistence", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("round-trips a saved workout", () => {
    saveWorkout(snapshot(), metadata);

    const loaded = loadSavedWorkout();

    expect(loaded?.snapshot).toEqual(snapshot());
    expect(loaded?.metadata).toEqual(metadata);
    expect(loaded?.savedAt).toBeTypeOf("number");
  });

  it("does not save a workout that never started", () => {
    saveWorkout(snapshot({ startedAt: undefined, state: "idle" }), metadata);

    expect(loadSavedWorkout()).toBeNull();
  });

  it("returns null when nothing has been saved", () => {
    expect(loadSavedWorkout()).toBeNull();
  });

  it("removes the saved workout on clear, and only then", () => {
    saveWorkout(snapshot(), metadata);
    expect(loadSavedWorkout()).not.toBeNull();

    clearSavedWorkout();

    expect(loadSavedWorkout()).toBeNull();
  });

  it("overwrites the previous save rather than accumulating entries", () => {
    saveWorkout(snapshot({ distanceM: 100 }), metadata);
    saveWorkout(snapshot({ distanceM: 250 }), metadata);

    expect(loadSavedWorkout()?.snapshot.distanceM).toBe(250);
  });

  it("ignores corrupt storage instead of throwing", () => {
    window.localStorage.setItem("treadlogger.saved-workout", "{not json");

    expect(loadSavedWorkout()).toBeNull();
  });
});
