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
