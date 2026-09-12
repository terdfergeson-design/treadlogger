import { parseTreadmillData } from "../ble/ftms/treadmill-data";
import { parseSupportedInclinationRange, parseSupportedSpeedRange } from "../ble/ftms/ranges";
import { parseFitnessMachineStatus, StatusOpCode } from "../ble/ftms/status";
import { parseFitnessMachineFeature } from "../ble/ftms/features";
import { parseHeartRateMeasurement } from "../ble/hr/measurement";
import {
  emptyHeartRateSnapshot,
  emptyTreadmillSnapshot,
  HeartRateSource,
  TreadmillSource,
} from "../ble/types";
import {
  buildFeaturePayload,
  buildHeartRateMeasurementPayload,
  buildInclinationRangePayload,
  buildSpeedRangePayload,
  buildStatusPayload,
  buildTreadmillDataPayload,
} from "./payloads";
import {
  advanceHeartRate,
  DEFAULT_RUNNER_PROFILE,
  energyRateKcalPerMinute,
  metabolicEquivalent,
  relativeIntensity,
  steadyStateHeartRate,
  type RunnerProfile,
} from "./physiology";

/**
 * Simulator mode.
 *
 * A fake treadmill and chest strap that stand in for hardware, so the whole
 * workout and export flow can be driven without a treadmill in the room. It is
 * deliberately kept behind the same {@link TreadmillSource} and
 * {@link HeartRateSource} interfaces as the Web Bluetooth clients, and it emits
 * the same GATT byte payloads that real peripherals would, which are then run
 * back through the production parsers. Nothing downstream is aware it is fake.
 */

const TREADMILL_TICK_MS = 500;
const HEART_RATE_TICK_MS = 1_000;
const CONNECT_LATENCY_MS = 650;

/** Belt and incline actuators move at a limited rate, as on a real machine. */
const SPEED_RAMP_KPH_PER_S = 0.9;
const INCLINE_RAMP_PERCENT_PER_S = 1.2;

const SIMULATED_SPEED_RANGE = { minKph: 1, maxKph: 16, incrementKph: 0.1 };
const SIMULATED_INCLINE_RANGE = { minPercent: 0, maxPercent: 15, incrementPercent: 1 };

/** Feature bits a treadmill of this class advertises. */
const SIMULATED_MACHINE_FLAGS =
  (1 << 0) | // average speed
  (1 << 2) | // total distance
  (1 << 3) | // inclination
  (1 << 4) | // elevation gain
  (1 << 5) | // pace
  (1 << 9) | // expended energy
  (1 << 11) | // metabolic equivalent
  (1 << 12); // elapsed time

const SIMULATED_TARGET_FLAGS =
  (1 << 0) | // speed target
  (1 << 1); // inclination target

/** Belt state shared between the simulated treadmill and strap. */
interface SimulatedBelt {
  running: boolean;
  speedKph: number;
  targetSpeedKph: number;
  inclinePercent: number;
  targetInclinePercent: number;
  distanceM: number;
  elapsedS: number;
  energyKcal: number;
  positiveElevationM: number;
  heartRateBpm: number;
}

function createBelt(profile: RunnerProfile): SimulatedBelt {
  return {
    running: false,
    speedKph: 0,
    targetSpeedKph: 8,
    inclinePercent: 0,
    targetInclinePercent: 0,
    distanceM: 0,
    elapsedS: 0,
    energyKcal: 0,
    positiveElevationM: 0,
    heartRateBpm: profile.restingHeartRateBpm,
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Moves `value` toward `target` without exceeding `maxDelta`. */
function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(target, value + maxDelta);
  return Math.max(target, value - maxDelta);
}

export class SimulatedTreadmill extends TreadmillSource {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly belt: SimulatedBelt,
    private readonly profile: RunnerProfile,
  ) {
    super(emptyTreadmillSnapshot("simulator"));
  }

  async connect(): Promise<void> {
    this.patch({ connection: "connecting", deviceName: "THERUN T15 (simulated)", error: undefined });
    await delay(CONNECT_LATENCY_MS);

    this.patch({
      connection: "connected",
      machineState: "stopped",
      // Read back through the parsers so the simulated capability reads exercise
      // the same code path a real machine would.
      features: parseFitnessMachineFeature(
        buildFeaturePayload(SIMULATED_MACHINE_FLAGS, SIMULATED_TARGET_FLAGS),
      ),
      speedRange: parseSupportedSpeedRange(
        buildSpeedRangePayload(
          SIMULATED_SPEED_RANGE.minKph,
          SIMULATED_SPEED_RANGE.maxKph,
          SIMULATED_SPEED_RANGE.incrementKph,
        ),
      ),
      inclineRange: parseSupportedInclinationRange(
        buildInclinationRangePayload(
          SIMULATED_INCLINE_RANGE.minPercent,
          SIMULATED_INCLINE_RANGE.maxPercent,
          SIMULATED_INCLINE_RANGE.incrementPercent,
        ),
      ),
    });

    await this.requestControl();
    this.startTicking();
    this.emitTreadmillData();
  }

  async disconnect(): Promise<void> {
    this.stopTicking();
    Object.assign(this.belt, createBelt(this.profile));
    this.replace({ ...emptyTreadmillSnapshot("simulator"), connection: "idle" });
  }

  async requestControl(): Promise<void> {
    await delay(80);
    this.patch({ hasControl: true, lastMessage: "Request control succeeded" });
  }

  async start(): Promise<void> {
    this.belt.running = true;
    this.applyStatus(StatusOpCode.startedOrResumedByUser);
    this.patch({ machineState: "running" });
  }

  async pause(): Promise<void> {
    this.belt.running = false;
    this.applyStatus(StatusOpCode.stoppedOrPausedByUser, [0x02]);
    this.patch({ machineState: "paused" });
  }

  async stop(): Promise<void> {
    this.belt.running = false;
    this.applyStatus(StatusOpCode.stoppedOrPausedByUser, [0x01]);
    this.patch({ machineState: "stopped" });
  }

  async setTargetSpeed(speedKph: number): Promise<void> {
    const { minKph, maxKph } = SIMULATED_SPEED_RANGE;
    if (speedKph < minKph || speedKph > maxKph) {
      // Mirrors the machine rejecting an out-of-range target rather than
      // silently clamping, which is what the control point actually does.
      throw new Error(
        `Set target speed failed: the treadmill rejected the value as out of range`,
      );
    }

    this.belt.targetSpeedKph = speedKph;
    this.patch({ lastMessage: `Target speed set to ${speedKph.toFixed(1)} km/h` });
  }

  async setTargetIncline(inclinePercent: number): Promise<void> {
    const { minPercent, maxPercent } = SIMULATED_INCLINE_RANGE;
    if (inclinePercent < minPercent || inclinePercent > maxPercent) {
      throw new Error(
        `Set target incline failed: the treadmill rejected the value as out of range`,
      );
    }

    this.belt.targetInclinePercent = inclinePercent;
    this.patch({ lastMessage: `Target incline set to ${inclinePercent.toFixed(1)}%` });
  }

  private startTicking(): void {
    this.stopTicking();
    this.timer = setInterval(() => this.tick(), TREADMILL_TICK_MS);
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const dt = TREADMILL_TICK_MS / 1000;
    const belt = this.belt;

    // A stopped belt coasts to zero instead of jumping, matching the ramp a real
    // treadmill takes and keeping the distance integral honest.
    const speedGoal = belt.running ? belt.targetSpeedKph : 0;
    belt.speedKph = approach(belt.speedKph, speedGoal, SPEED_RAMP_KPH_PER_S * dt);
    belt.inclinePercent = approach(
      belt.inclinePercent,
      belt.targetInclinePercent,
      INCLINE_RAMP_PERCENT_PER_S * dt,
    );

    if (belt.speedKph > 0) {
      const metresTravelled = (belt.speedKph / 3.6) * dt;
      belt.distanceM += metresTravelled;
      belt.positiveElevationM += metresTravelled * (Math.max(0, belt.inclinePercent) / 100);
      belt.energyKcal +=
        (energyRateKcalPerMinute(belt.speedKph, belt.inclinePercent, this.profile.weightKg) / 60) * dt;
    }

    if (belt.running) belt.elapsedS += dt;

    this.emitTreadmillData();
  }

  private emitTreadmillData(): void {
    const belt = this.belt;
    const averageSpeedKph = belt.elapsedS > 0 ? (belt.distanceM / belt.elapsedS) * 3.6 : 0;

    const payload = buildTreadmillDataPayload({
      speedKph: belt.speedKph,
      averageSpeedKph,
      totalDistanceM: belt.distanceM,
      inclinationPercent: belt.inclinePercent,
      rampAngleDegrees: (Math.atan(belt.inclinePercent / 100) * 180) / Math.PI,
      positiveElevationGainM: belt.positiveElevationM,
      negativeElevationGainM: 0,
      instantaneousPaceMinPerKm: belt.speedKph > 0 ? 60 / belt.speedKph : undefined,
      averagePaceMinPerKm: averageSpeedKph > 0 ? 60 / averageSpeedKph : undefined,
      totalEnergyKcal: belt.energyKcal,
      energyPerHourKcal:
        energyRateKcalPerMinute(belt.speedKph, belt.inclinePercent, this.profile.weightKg) * 60,
      energyPerMinuteKcal: energyRateKcalPerMinute(
        belt.speedKph,
        belt.inclinePercent,
        this.profile.weightKg,
      ),
      metabolicEquivalent: metabolicEquivalent(belt.speedKph, belt.inclinePercent),
      elapsedTimeS: belt.elapsedS,
    });

    this.patch({ data: parseTreadmillData(payload), lastUpdateAt: Date.now() });
  }

  private applyStatus(opCode: number, parameter: number[] = []): void {
    const status = parseFitnessMachineStatus(buildStatusPayload(opCode, parameter));
    this.patch({ lastMessage: status.message });
  }
}

export class SimulatedHeartRateMonitor extends HeartRateSource {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly belt: SimulatedBelt,
    private readonly profile: RunnerProfile,
  ) {
    super(emptyHeartRateSnapshot("simulator"));
  }

  async connect(): Promise<void> {
    this.patch({ connection: "connecting", deviceName: "Chest strap (simulated)", error: undefined });
    await delay(CONNECT_LATENCY_MS);

    this.patch({
      connection: "connected",
      bodySensorLocation: "Chest",
      batteryPercent: 78,
    });

    this.timer = setInterval(() => this.tick(), HEART_RATE_TICK_MS);
    this.tick();
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.belt.heartRateBpm = this.profile.restingHeartRateBpm;
    this.replace({ ...emptyHeartRateSnapshot("simulator"), connection: "idle" });
  }

  private tick(): void {
    const dt = HEART_RATE_TICK_MS / 1000;
    const intensity = relativeIntensity(this.belt.speedKph, this.belt.inclinePercent, this.profile);
    const target = steadyStateHeartRate(intensity, this.profile);

    this.belt.heartRateBpm = advanceHeartRate(this.belt.heartRateBpm, target, dt);

    // A couple of bpm of jitter, so the readout looks like a sensor rather than
    // a curve, and downstream averaging gets something realistic to chew on.
    const jittered = Math.round(this.belt.heartRateBpm + (Math.random() - 0.5) * 3);
    const beatIntervalS = 60 / Math.max(40, jittered);

    const payload = buildHeartRateMeasurementPayload({
      heartRateBpm: jittered,
      sensorContactSupported: true,
      sensorContactDetected: true,
      rrIntervalsS: [
        beatIntervalS * (1 + (Math.random() - 0.5) * 0.05),
        beatIntervalS * (1 + (Math.random() - 0.5) * 0.05),
      ],
    });

    this.patch({
      measurement: parseHeartRateMeasurement(payload),
      lastUpdateAt: Date.now(),
    });
  }
}

export interface Simulator {
  treadmill: SimulatedTreadmill;
  heartRate: SimulatedHeartRateMonitor;
}

/**
 * Creates a paired treadmill and strap that share one belt state, so heart rate
 * responds to the speed and incline the user sets.
 */
export function createSimulator(profile: RunnerProfile = DEFAULT_RUNNER_PROFILE): Simulator {
  const belt = createBelt(profile);
  return {
    treadmill: new SimulatedTreadmill(belt, profile),
    heartRate: new SimulatedHeartRateMonitor(belt, profile),
  };
}
