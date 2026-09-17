import { describe, expect, it } from "vitest";
import type { TreadmillData } from "../ble/ftms/treadmill-data";
import type { HeartRateMeasurement } from "../ble/hr/measurement";
import { WorkoutRecorder, type DeviceReading } from "./session";

const T0 = Date.UTC(2026, 0, 15, 7, 30, 0);

const treadmill = (fields: Partial<TreadmillData>): TreadmillData => ({ flags: 0, ...fields });

const heartRate = (bpm: number): HeartRateMeasurement => ({
  flags: 0,
  heartRateBpm: bpm,
  sensorContact: "detected",
});

const reading = (
  treadmillFields: Partial<TreadmillData>,
  bpm?: number,
): DeviceReading => ({
  treadmill: treadmill(treadmillFields),
  ...(bpm === undefined ? {} : { heartRate: heartRate(bpm) }),
});

function newRecorder() {
  return new WorkoutRecorder({ maxHeartRateBpm: 190 });
}

describe("WorkoutRecorder", () => {
  it("starts idle and ignores readings until started", () => {
    const recorder = newRecorder();

    recorder.tick(reading({ speedKph: 10, totalDistanceM: 100 }), T0);

    expect(recorder.snapshot.state).toBe("idle");
    expect(recorder.snapshot.samples).toHaveLength(0);
  });

  it("treats the first reading as a baseline, since treadmill counters do not start at zero", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    // The machine has 4.2 km on its counter from an earlier run.
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 4200 }), T0 + 1_000);

    expect(recorder.snapshot.distanceM).toBe(0);

    recorder.tick(reading({ speedKph: 10, totalDistanceM: 4202.5 }), T0 + 2_000);

    expect(recorder.snapshot.distanceM).toBeCloseTo(2.5, 6);
  });

  it("accumulates distance, energy and ascent as deltas", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(
      reading({ speedKph: 10, totalDistanceM: 100, totalEnergyKcal: 40, positiveElevationGainM: 5 }),
      T0 + 1_000,
    );
    recorder.tick(
      reading({ speedKph: 10, totalDistanceM: 110, totalEnergyKcal: 41, positiveElevationGainM: 5.4 }),
      T0 + 2_000,
    );
    recorder.tick(
      reading({ speedKph: 10, totalDistanceM: 120, totalEnergyKcal: 42, positiveElevationGainM: 5.9 }),
      T0 + 3_000,
    );

    expect(recorder.snapshot.distanceM).toBeCloseTo(20, 6);
    expect(recorder.snapshot.energyKcal).toBeCloseTo(2, 6);
    expect(recorder.snapshot.elevationGainM).toBeCloseTo(0.9, 6);
  });

  it("derives elevation gain from incline and distance when the treadmill has no elevation gain field", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    // No positiveElevationGainM anywhere — most treadmills only report grade.
    // 10 km/h for 1 s covers ~2.778 m; at 5 % grade that's ~0.1389 m of climb.
    recorder.tick(reading({ speedKph: 10, inclinationPercent: 5 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, inclinationPercent: 5 }), T0 + 2_000);

    expect(recorder.snapshot.elevationGainM).toBeCloseTo(0.2778, 3);
  });

  it("credits no elevation for a decline when deriving gain from incline", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 10, inclinationPercent: -3 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, inclinationPercent: -3 }), T0 + 2_000);

    expect(recorder.snapshot.elevationGainM).toBe(0);
  });

  it("tracks a continuous altitude profile from grade, unlike the ascent-only elevationGainM total", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    // 10 km/h for 1 s covers ~2.778 m; a 5 % climb rises ~0.1389 m.
    recorder.tick(reading({ speedKph: 10, inclinationPercent: 5 }), T0 + 1_000);
    expect(recorder.snapshot.samples[0].elevationM).toBeCloseTo(0.1389, 3);
    expect(recorder.snapshot.elevationGainM).toBeCloseTo(0.1389, 3);

    // A decline lowers the altitude trace, even though elevationGainM (total
    // ascent) never decreases.
    recorder.tick(reading({ speedKph: 10, inclinationPercent: -5 }), T0 + 2_000);
    expect(recorder.snapshot.samples[1].elevationM).toBeCloseTo(0, 3);
    expect(recorder.snapshot.elevationGainM).toBeCloseTo(0.1389, 3);
  });

  it("resets the altitude profile to 0 on a fresh start", () => {
    const recorder = newRecorder();
    recorder.start(T0);
    recorder.tick(reading({ speedKph: 10, inclinationPercent: 5 }), T0 + 1_000);
    expect(recorder.snapshot.samples[0].elevationM).toBeGreaterThan(0);

    recorder.start(T0 + 100_000);
    recorder.tick(reading({ speedKph: 10 }), T0 + 101_000);
    expect(recorder.snapshot.samples[0].elevationM).toBeCloseTo(0, 6);
  });

  it("re-baselines instead of going backwards when the treadmill resets its counter", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 10, totalDistanceM: 500 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 510 }), T0 + 2_000);
    // Machine reset: the counter drops to near zero mid-workout.
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 2 }), T0 + 3_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 12 }), T0 + 4_000);

    expect(recorder.snapshot.distanceM).toBeCloseTo(20, 6);
  });

  it("integrates speed when the treadmill reports no distance at all", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    // 10.8 km/h is exactly 3 m/s.
    recorder.tick(reading({ speedKph: 10.8 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10.8 }), T0 + 2_000);

    expect(recorder.snapshot.distanceM).toBeCloseTo(6, 6);
  });

  it("records one sample per tick with the running totals", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 9, totalDistanceM: 0, inclinationPercent: 1.5 }, 120), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 10, inclinationPercent: 2 }, 130), T0 + 2_000);

    expect(recorder.snapshot.samples).toHaveLength(2);
    expect(recorder.snapshot.samples[1]).toMatchObject({
      timestamp: T0 + 2_000,
      speedKph: 10,
      inclinePercent: 2,
      heartRateBpm: 130,
    });
    expect(recorder.snapshot.samples[1].distanceM).toBeCloseTo(10, 6);
  });

  it("keeps timer time separate from wall-clock time across a pause", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 10, totalDistanceM: 0 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 10 }), T0 + 2_000);

    recorder.pause(T0 + 3_000);
    // Six seconds of standing around.
    recorder.resume(T0 + 9_000);

    recorder.tick(reading({ speedKph: 10, totalDistanceM: 60 }), T0 + 10_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 70 }), T0 + 11_000);

    expect(recorder.snapshot.elapsedS).toBeCloseTo(5, 3);
    expect(recorder.snapshot.totalElapsedS).toBeCloseTo(11, 3);
  });

  it("credits no distance for belt movement during a pause", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 10, totalDistanceM: 0 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 10 }), T0 + 2_000);

    recorder.pause(T0 + 3_000);
    // Readings that arrive while paused must not move any total.
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 100 }), T0 + 4_000);
    expect(recorder.snapshot.distanceM).toBeCloseTo(10, 6);
    expect(recorder.snapshot.samples).toHaveLength(2);

    recorder.resume(T0 + 5_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 200 }), T0 + 6_000);
    // The first reading after a resume re-baselines rather than crediting the
    // 190 m the belt covered while paused.
    expect(recorder.snapshot.distanceM).toBeCloseTo(10, 6);

    recorder.tick(reading({ speedKph: 10, totalDistanceM: 210 }), T0 + 7_000);
    expect(recorder.snapshot.distanceM).toBeCloseTo(20, 6);
  });

  it("tracks average, maximum and minimum heart rate", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 10 }, 120), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10 }, 150), T0 + 2_000);
    recorder.tick(reading({ speedKph: 10 }, 132), T0 + 3_000);

    expect(recorder.snapshot.heartRateBpm).toBe(132);
    expect(recorder.snapshot.avgHeartRateBpm).toBeCloseTo(134, 6);
    expect(recorder.snapshot.maxHeartRateBpm).toBe(150);
    expect(recorder.snapshot.minHeartRateBpm).toBe(120);
  });

  it("falls back to the treadmill's heart rate when no strap is connected", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick({ treadmill: treadmill({ speedKph: 10, heartRateBpm: 118 }) }, T0 + 1_000);

    expect(recorder.snapshot.heartRateBpm).toBe(118);
  });

  it("accumulates time in heart rate zones", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    // 190 bpm max: 120 is 63 % (zone 2), 155 is 82 % (zone 4), 80 is below zone 1.
    recorder.tick(reading({ speedKph: 10 }, 120), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10 }, 120), T0 + 2_000);
    recorder.tick(reading({ speedKph: 12 }, 155), T0 + 3_000);
    recorder.tick(reading({ speedKph: 4 }, 80), T0 + 4_000);

    expect(recorder.snapshot.timeInZones[2]).toBeCloseTo(2, 3);
    expect(recorder.snapshot.timeInZones[4]).toBeCloseTo(1, 3);
    expect(recorder.snapshot.timeInZones[0]).toBeCloseTo(1, 3);
  });

  it("tracks maximum speed and incline", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 9, inclinationPercent: 1 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 14.2, inclinationPercent: 6.5 }), T0 + 2_000);
    recorder.tick(reading({ speedKph: 8, inclinationPercent: 0 }), T0 + 3_000);

    expect(recorder.snapshot.maxSpeedKph).toBe(14.2);
    expect(recorder.snapshot.maxInclinePercent).toBe(6.5);
    expect(recorder.snapshot.speedKph).toBe(8);
  });

  it("derives cadence in steps per minute from the treadmill's step count, smoothed over a rolling window", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 8, stepCount: 100 }), T0 + 1_000);
    expect(recorder.snapshot.cadenceSpm).toBeUndefined(); // first reading just baselines

    recorder.tick(reading({ speedKph: 8, stepCount: 103 }), T0 + 2_000);
    // Only 1 s of step-count history on record so far — too little to
    // average over, so cadence stays unset rather than reporting a single
    // noisy tick's worth of steps.
    expect(recorder.snapshot.cadenceSpm).toBeUndefined();

    recorder.tick(reading({ speedKph: 8, stepCount: 105 }), T0 + 3_000);
    // 5 steps over the 2 s window now on record: 150 spm.
    expect(recorder.snapshot.cadenceSpm).toBeCloseTo(150, 6);

    recorder.tick(reading({ speedKph: 8, stepCount: 108 }), T0 + 4_000);
    // 8 steps over the 3 s window: 160 spm.
    expect(recorder.snapshot.cadenceSpm).toBeCloseTo(160, 6);

    // Average cadence over the whole workout so far: 8 steps in 4 seconds.
    expect(recorder.snapshot.avgCadenceSpm).toBeCloseTo(120, 6);
  });

  it("smooths a treadmill's whole-step counter instead of swinging between 60 and 120 spm", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    // A real treadmill's step counter only ever moves in whole steps, so a
    // steady ~90 spm walking pace shows up as the counter alternating +1,
    // +2, +1, +2... each second. Deriving cadence from a single tick's delta
    // reports that as the readout literally alternating between exactly 60
    // and exactly 120 spm every second — the bug this window smooths away.
    const stepCounts = [100, 101, 103, 104, 106, 107, 109, 110];
    const cadences: (number | undefined)[] = [];
    stepCounts.forEach((stepCount, index) => {
      recorder.tick(reading({ speedKph: 8, stepCount }), T0 + (index + 1) * 1_000);
      cadences.push(recorder.snapshot.cadenceSpm);
    });

    const settled = cadences.filter((value): value is number => value !== undefined);
    expect(settled.length).toBeGreaterThan(0);
    for (const cadence of settled) {
      expect(cadence).not.toBe(60);
      expect(cadence).not.toBe(120);
    }

    // It should converge toward the true average pace (~90 spm) instead of
    // swinging wildly from one tick to the next.
    expect(settled.at(-1)).toBeCloseTo(90, 0);
  });

  it("leaves cadence unset for treadmills that never report a step count", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 8 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 8 }), T0 + 2_000);

    expect(recorder.snapshot.cadenceSpm).toBeUndefined();
    expect(recorder.snapshot.avgCadenceSpm).toBeUndefined();
  });

  it("re-baselines cadence after a pause instead of crediting steps taken while paused", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 8, stepCount: 100 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 8, stepCount: 103 }), T0 + 2_000);

    recorder.pause(T0 + 3_000);
    recorder.resume(T0 + 5_000);

    // Even though the counter jumped by 20 while paused, none of that can
    // show up as cadence: the window was cleared on pause, so it has to
    // rebuild from scratch after resume.
    recorder.tick(reading({ speedKph: 8, stepCount: 123 }), T0 + 6_000);
    expect(recorder.snapshot.cadenceSpm).toBeUndefined(); // rebaselines, one sample on record

    recorder.tick(reading({ speedKph: 8, stepCount: 126 }), T0 + 7_000);
    expect(recorder.snapshot.cadenceSpm).toBeUndefined(); // only 1 s of post-resume history so far

    recorder.tick(reading({ speedKph: 8, stepCount: 129 }), T0 + 8_000);
    // 2 s of history since resume, all of it post-pause: 6 steps / 2 s = 180 spm.
    expect(recorder.snapshot.cadenceSpm).toBeCloseTo(180, 6);
  });

  it("derives pace from speed and leaves it unset when stopped", () => {
    const recorder = newRecorder();
    recorder.start(T0);

    recorder.tick(reading({ speedKph: 12 }), T0 + 1_000);
    expect(recorder.snapshot.paceMinPerKm).toBeCloseTo(5, 6);

    recorder.tick(reading({ speedKph: 0 }), T0 + 2_000);
    expect(recorder.snapshot.paceMinPerKm).toBeUndefined();
  });

  it("stops accepting readings once finished", () => {
    const recorder = newRecorder();
    recorder.start(T0);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 0 }), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 10 }), T0 + 2_000);

    recorder.finish(T0 + 3_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 500 }), T0 + 4_000);

    expect(recorder.snapshot.state).toBe("finished");
    expect(recorder.snapshot.endedAt).toBe(T0 + 3_000);
    expect(recorder.snapshot.distanceM).toBeCloseTo(10, 6);
    expect(recorder.snapshot.samples).toHaveLength(2);
  });

  it("counts paused time toward the total when finishing from a pause", () => {
    const recorder = newRecorder();
    recorder.start(T0);
    recorder.tick(reading({ speedKph: 10 }), T0 + 1_000);

    recorder.pause(T0 + 2_000);
    recorder.finish(T0 + 8_000);

    expect(recorder.snapshot.state).toBe("finished");
    expect(recorder.snapshot.endedAt).toBe(T0 + 8_000);
  });

  it("clears everything on reset", () => {
    const recorder = newRecorder();
    recorder.start(T0);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 0 }, 140), T0 + 1_000);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 25 }, 145), T0 + 2_000);
    recorder.finish(T0 + 3_000);

    recorder.reset();

    expect(recorder.snapshot).toMatchObject({
      state: "idle",
      distanceM: 0,
      elapsedS: 0,
      samples: [],
    });
    expect(recorder.snapshot.avgHeartRateBpm).toBeUndefined();
    expect(recorder.snapshot.maxHeartRateBpm).toBeUndefined();
    expect(recorder.snapshot.startedAt).toBeUndefined();
  });

  it("restore replaces the snapshot outright, for loading a recovered workout", () => {
    const recorder = newRecorder();
    recorder.start(T0);
    recorder.tick(reading({ speedKph: 10, totalDistanceM: 25 }, 140), T0 + 1_000);

    const saved = { ...recorder.snapshot, state: "finished" as const, endedAt: T0 + 5_000 };
    const fresh = newRecorder();
    fresh.restore(saved);

    expect(fresh.snapshot).toEqual(saved);

    // A tick after restore is a no-op: restore is playback only, not a point
    // to resume ticking from — ticking against a `"finished"` snapshot is
    // already a no-op for any recorder, restored or not.
    fresh.tick(reading({ speedKph: 10, totalDistanceM: 999 }), T0 + 6_000);
    expect(fresh.snapshot).toEqual(saved);
  });

  it("notifies subscribers when the snapshot changes", () => {
    const recorder = newRecorder();
    let notifications = 0;
    const unsubscribe = recorder.subscribe(() => {
      notifications += 1;
    });

    recorder.start(T0);
    recorder.tick(reading({ speedKph: 10 }), T0 + 1_000);
    unsubscribe();
    recorder.tick(reading({ speedKph: 10 }), T0 + 2_000);

    expect(notifications).toBe(2);
  });
});
