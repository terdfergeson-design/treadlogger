import { ObservableStore } from "../ble/observable-store";
import { paceFromSpeed, type TreadmillData } from "../ble/ftms/treadmill-data";
import type { HeartRateMeasurement } from "../ble/hr/measurement";
import { emptyTimeInZones, zoneForHeartRate, type TimeInZones } from "./hr-zones";

/**
 * Workout recorder.
 *
 * Owns everything the FIT export needs: the sample log, the running totals, and
 * the start and end timestamps. Treadmills report distance and energy as
 * cumulative counters that started when the machine powered on and keep running
 * through a pause, so the recorder accumulates deltas while active rather than
 * trusting those totals directly. That also survives a machine-side counter
 * reset, which shows up as a total that moves backwards.
 */

export type WorkoutState = "idle" | "active" | "paused" | "finished";

/**
 * Rolling window used to smooth cadence. The vendor step counter only ever
 * advances in whole steps, so a bare single-tick delta quantizes hard: one
 * step in a ~1 s tick reads as exactly 60 spm, two steps as exactly 120 spm,
 * with nothing in between — which is what made the live readout visibly
 * snap between 60 and 120 instead of tracking a steady walking pace.
 * Averaging steps over several seconds smooths that out.
 */
const CADENCE_WINDOW_MS = 6_000;
/** Minimum span of step-count history required before reporting any cadence
 *  at all — avoids a wild, single-sample number right after starting or
 *  resuming. */
const CADENCE_MIN_WINDOW_MS = 2_000;

/** One second of the workout. The FIT `record` messages are built from these. */
export interface WorkoutSample {
  /** Wall-clock time of the sample, epoch millis. */
  timestamp: number;
  /** Timer time since the workout started, excluding paused time. */
  elapsedS: number;
  /** Distance covered during this workout, in metres. */
  distanceM: number;
  speedKph: number;
  inclinePercent?: number;
  heartRateBpm?: number;
  /** Cumulative energy for this workout, in kcal. */
  energyKcal?: number;
  cadenceSpm?: number;
  /**
   * Altitude relative to the start of the workout, in metres, derived from
   * grade × distance covered. Unlike `elevationGainM` (which only ever
   * climbs, tracking total ascent), this rises and falls with the belt's
   * incline — a continuous profile for the FIT file's elevation trace.
   * Treadmills have no real-world elevation, so it's relative to 0 at the
   * start line, the same synthesis indoor cycling platforms use for rides.
   */
  elevationM?: number;
}

export interface WorkoutSnapshot {
  state: WorkoutState;
  /** Epoch millis when the workout started, undefined while idle. */
  startedAt?: number;
  endedAt?: number;
  /** Timer time in seconds: wall time minus paused time. */
  elapsedS: number;
  /** Wall-clock seconds from start to now, including pauses. */
  totalElapsedS: number;
  distanceM: number;
  elevationGainM: number;
  energyKcal: number;

  speedKph: number;
  avgSpeedKph: number;
  maxSpeedKph: number;

  inclinePercent?: number;
  maxInclinePercent: number;

  heartRateBpm?: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  minHeartRateBpm?: number;

  /** Current pace in minutes per kilometre, derived from speed. */
  paceMinPerKm?: number;
  avgPaceMinPerKm?: number;

  /**
   * Steps per minute, derived from the treadmill's cumulative step count
   * when it reports one — see `TreadmillDataFlag.stepCount`. Undefined for
   * machines that never send a step count.
   */
  cadenceSpm?: number;
  avgCadenceSpm?: number;

  timeInZones: TimeInZones;
  samples: WorkoutSample[];
}

const emptySnapshot = (): WorkoutSnapshot => ({
  state: "idle",
  elapsedS: 0,
  totalElapsedS: 0,
  distanceM: 0,
  elevationGainM: 0,
  energyKcal: 0,
  speedKph: 0,
  avgSpeedKph: 0,
  maxSpeedKph: 0,
  maxInclinePercent: 0,
  timeInZones: emptyTimeInZones(),
  samples: [],
});

/** A reading of both devices at one instant, supplied by the caller each tick. */
export interface DeviceReading {
  treadmill: TreadmillData;
  heartRate?: HeartRateMeasurement;
}

export interface WorkoutRecorderOptions {
  /** Used to bucket heart rate into training zones. */
  maxHeartRateBpm: number;
  /** Sampling period. One second matches the FIT record convention. */
  sampleIntervalMs?: number;
}

export class WorkoutRecorder extends ObservableStore<WorkoutSnapshot> {
  private readonly sampleIntervalMs: number;
  private maxHeartRateBpm: number;

  /** Last cumulative counters seen from the treadmill, for delta accumulation. */
  private previousTotals: {
    distanceM?: number;
    energyKcal?: number;
    elevationGainM?: number;
    stepCount?: number;
  } = {};

  private heartRateSum = 0;
  private heartRateCount = 0;
  private totalSteps = 0;
  /** Whether the treadmill has ever reported a step count this workout. */
  private hasStepCountData = false;
  /** Recent (timestamp, cumulative step count) samples, used to smooth the
   *  live cadence readout over CADENCE_WINDOW_MS instead of one tick at a
   *  time. Cleared on start/reset/pause so it never spans a gap. */
  private stepHistory: { atMs: number; steps: number }[] = [];
  /** Running altitude relative to the workout's start, for `WorkoutSample.elevationM`. */
  private altitudeM = 0;
  private lastTickAt?: number;
  private pausedMs = 0;
  private pausedAt?: number;

  constructor(options: WorkoutRecorderOptions) {
    super(emptySnapshot());
    this.maxHeartRateBpm = options.maxHeartRateBpm;
    this.sampleIntervalMs = options.sampleIntervalMs ?? 1_000;
  }

  setMaxHeartRate(maxHeartRateBpm: number): void {
    this.maxHeartRateBpm = maxHeartRateBpm;
  }

  get sampleIntervalSeconds(): number {
    return this.sampleIntervalMs / 1_000;
  }

  start(now = Date.now()): void {
    this.previousTotals = {};
    this.heartRateSum = 0;
    this.heartRateCount = 0;
    this.totalSteps = 0;
    this.hasStepCountData = false;
    this.stepHistory = [];
    this.altitudeM = 0;
    this.pausedMs = 0;
    this.pausedAt = undefined;
    this.lastTickAt = now;

    this.replace({ ...emptySnapshot(), state: "active", startedAt: now });
  }

  pause(now = Date.now()): void {
    if (this.snapshot.state !== "active") return;
    this.pausedAt = now;
    // Counters are re-baselined on resume, so belt movement during the pause is
    // not credited to the workout. The cadence window is cleared for the same
    // reason — otherwise its next reading would average steps in with the
    // wall-clock gap the pause left behind.
    this.previousTotals = {};
    this.stepHistory = [];
    this.patch({ state: "paused", speedKph: 0 });
  }

  resume(now = Date.now()): void {
    if (this.snapshot.state !== "paused") return;
    if (this.pausedAt !== undefined) this.pausedMs += now - this.pausedAt;
    this.pausedAt = undefined;
    this.lastTickAt = now;
    this.patch({ state: "active" });
  }

  finish(now = Date.now()): void {
    if (this.snapshot.state === "idle" || this.snapshot.state === "finished") return;
    if (this.pausedAt !== undefined) {
      this.pausedMs += now - this.pausedAt;
      this.pausedAt = undefined;
    }
    this.patch({ state: "finished", endedAt: now, speedKph: 0 });
  }

  reset(): void {
    this.previousTotals = {};
    this.heartRateSum = 0;
    this.heartRateCount = 0;
    this.totalSteps = 0;
    this.hasStepCountData = false;
    this.stepHistory = [];
    this.altitudeM = 0;
    this.pausedMs = 0;
    this.pausedAt = undefined;
    this.lastTickAt = undefined;
    this.replace(emptySnapshot());
  }

  /**
   * Folds one reading into the session.
   *
   * Called on a fixed interval by the caller. Readings taken while paused or
   * finished update nothing, so a belt still coasting to a stop cannot inflate
   * the recorded distance.
   */
  tick(reading: DeviceReading, now = Date.now()): void {
    const snapshot = this.snapshot;
    if (snapshot.state !== "active" || snapshot.startedAt === undefined) return;

    const dtSeconds = this.lastTickAt === undefined
      ? this.sampleIntervalSeconds
      : Math.max(0, (now - this.lastTickAt) / 1_000);
    this.lastTickAt = now;

    const speedKph = reading.treadmill.speedKph ?? 0;
    const inclinePercent = reading.treadmill.inclinationPercent;
    const heartRateBpm = reading.heartRate?.heartRateBpm ?? reading.treadmill.heartRateBpm;

    const distanceDeltaM =
      this.accumulate("distanceM", reading.treadmill.totalDistanceM) +
      // Integrate speed when the treadmill does not report distance at all.
      (reading.treadmill.totalDistanceM === undefined ? (speedKph / 3.6) * dtSeconds : 0);
    const distanceM = snapshot.distanceM + distanceDeltaM;

    const energyKcal = snapshot.energyKcal + this.accumulate("energyKcal", reading.treadmill.totalEnergyKcal);
    const elevationGainM =
      snapshot.elevationGainM +
      (reading.treadmill.positiveElevationGainM !== undefined
        ? this.accumulate("elevationGainM", reading.treadmill.positiveElevationGainM)
        : // FTMS's Elevation Gain field is a separate, rarely implemented
          // characteristic — most treadmills (including grade-only machines)
          // never send it, only the Inclination field. Without it, derive
          // climbed elevation from grade x horizontal distance covered, the
          // way most fitness apps do; declines (negative grade) don't
          // subtract, matching what a dedicated "positive elevation gain"
          // field would report.
          (Math.max(0, inclinePercent ?? 0) / 100) * distanceDeltaM);

    // A continuous altitude trace for the FIT file's elevation profile,
    // distinct from elevationGainM above: that only ever climbs (it tracks
    // total ascent), while this rises AND falls with the belt's incline, the
    // way a real elevation profile would.
    this.altitudeM += ((inclinePercent ?? 0) / 100) * distanceDeltaM;

    // Cadence has no FTMS-defined source — it only exists on machines that
    // report a step count on the vendor-specific bit (see
    // TreadmillDataFlag.stepCount), so it stays undefined everywhere else.
    const stepCountDeltaThisTick = this.accumulate("stepCount", reading.treadmill.stepCount);
    if (reading.treadmill.stepCount !== undefined) this.hasStepCountData = true;
    this.totalSteps += stepCountDeltaThisTick;

    if (reading.treadmill.stepCount !== undefined) {
      this.stepHistory.push({ atMs: now, steps: this.totalSteps });
    }
    const cadenceCutoffMs = now - CADENCE_WINDOW_MS;
    while (this.stepHistory.length > 1 && this.stepHistory[0].atMs < cadenceCutoffMs) {
      this.stepHistory.shift();
    }
    // A baselining tick (the first of the workout, or the first after a
    // pause) leaves only one sample on record, so there's no span to average
    // over yet — report no cadence rather than a misleading number.
    const cadenceWindowStart = this.stepHistory[0];
    const cadenceWindowMs = cadenceWindowStart ? now - cadenceWindowStart.atMs : 0;
    const cadenceSpm =
      cadenceWindowStart && cadenceWindowMs >= CADENCE_MIN_WINDOW_MS
        ? ((this.totalSteps - cadenceWindowStart.steps) / (cadenceWindowMs / 1000)) * 60
        : undefined;

    const elapsedS = Math.max(0, (now - snapshot.startedAt - this.pausedMs) / 1_000);
    const totalElapsedS = Math.max(0, (now - snapshot.startedAt) / 1_000);

    if (heartRateBpm !== undefined) {
      this.heartRateSum += heartRateBpm;
      this.heartRateCount += 1;
    }

    const timeInZones = { ...snapshot.timeInZones };
    if (heartRateBpm !== undefined) {
      const zone = zoneForHeartRate(heartRateBpm, this.maxHeartRateBpm);
      const key = zone?.index ?? 0;
      timeInZones[key] = (timeInZones[key] ?? 0) + dtSeconds;
    }

    const sample: WorkoutSample = {
      timestamp: now,
      elapsedS,
      distanceM,
      speedKph,
      inclinePercent,
      heartRateBpm,
      energyKcal: energyKcal > 0 ? energyKcal : undefined,
      cadenceSpm,
      elevationM: this.altitudeM,
    };

    this.patch({
      elapsedS,
      totalElapsedS,
      distanceM,
      energyKcal,
      elevationGainM,
      speedKph,
      avgSpeedKph: elapsedS > 0 ? (distanceM / elapsedS) * 3.6 : 0,
      maxSpeedKph: Math.max(snapshot.maxSpeedKph, speedKph),
      inclinePercent,
      maxInclinePercent: Math.max(snapshot.maxInclinePercent, inclinePercent ?? 0),
      heartRateBpm,
      avgHeartRateBpm:
        this.heartRateCount > 0 ? this.heartRateSum / this.heartRateCount : undefined,
      maxHeartRateBpm:
        heartRateBpm === undefined
          ? snapshot.maxHeartRateBpm
          : Math.max(snapshot.maxHeartRateBpm ?? 0, heartRateBpm),
      minHeartRateBpm:
        heartRateBpm === undefined
          ? snapshot.minHeartRateBpm
          : Math.min(snapshot.minHeartRateBpm ?? Number.POSITIVE_INFINITY, heartRateBpm),
      paceMinPerKm: paceFromSpeed(speedKph),
      avgPaceMinPerKm: paceFromSpeed(elapsedS > 0 ? (distanceM / elapsedS) * 3.6 : 0),
      cadenceSpm,
      avgCadenceSpm: this.hasStepCountData && elapsedS > 0 ? (this.totalSteps / elapsedS) * 60 : undefined,
      timeInZones,
      samples: [...snapshot.samples, sample],
    });
  }

  /**
   * Returns how much a cumulative treadmill counter advanced since the last
   * reading. A counter that moved backwards means the machine reset it, so that
   * step is skipped and the new value becomes the baseline.
   */
  private accumulate(
    key: "distanceM" | "energyKcal" | "elevationGainM" | "stepCount",
    total: number | undefined,
  ): number {
    if (total === undefined) return 0;

    const previous = this.previousTotals[key];
    this.previousTotals[key] = total;

    if (previous === undefined || total < previous) return 0;
    return total - previous;
  }
}
