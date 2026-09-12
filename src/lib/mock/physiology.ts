/**
 * Physiology used by the simulator to make mock data behave like a real run.
 *
 * The oxygen-cost equations are the standard ACSM metabolic formulas for walking
 * and running on a graded treadmill. They matter here only because they give
 * calorie burn and heart-rate response that track speed and incline the way a
 * runner would expect, which is what makes the mock flow a useful demo.
 */

export interface RunnerProfile {
  weightKg: number;
  restingHeartRateBpm: number;
  maxHeartRateBpm: number;
  /** Aerobic ceiling in ml/kg/min, used to map effort onto heart rate. */
  vo2MaxMlPerKgPerMin: number;
}

export const DEFAULT_RUNNER_PROFILE: RunnerProfile = {
  weightKg: 75,
  restingHeartRateBpm: 55,
  maxHeartRateBpm: 190,
  vo2MaxMlPerKgPerMin: 52,
};

/** Resting oxygen consumption, one metabolic equivalent. */
const RESTING_VO2 = 3.5;

/** Above roughly this speed the running equation applies instead of walking. */
const WALK_RUN_TRANSITION_KPH = 7;

/** Oxygen cost of moving at a given belt speed and grade, in ml/kg/min. */
export function oxygenCost(speedKph: number, inclinePercent: number): number {
  if (speedKph <= 0) return RESTING_VO2;

  const metresPerMinute = (speedKph * 1000) / 60;
  const grade = inclinePercent / 100;

  if (speedKph < WALK_RUN_TRANSITION_KPH) {
    return 0.1 * metresPerMinute + 1.8 * metresPerMinute * grade + RESTING_VO2;
  }

  // Running carries the runner airborne, so the horizontal cost is higher while
  // the vertical cost is halved relative to walking.
  return 0.2 * metresPerMinute + 0.9 * metresPerMinute * grade + RESTING_VO2;
}

export function metabolicEquivalent(speedKph: number, inclinePercent: number): number {
  return oxygenCost(speedKph, inclinePercent) / RESTING_VO2;
}

/** Energy burn rate in kcal per minute. */
export function energyRateKcalPerMinute(
  speedKph: number,
  inclinePercent: number,
  weightKg: number,
): number {
  return (metabolicEquivalent(speedKph, inclinePercent) * RESTING_VO2 * weightKg) / 200;
}

/**
 * Effort as a fraction of aerobic capacity, which is what heart rate tracks.
 * Allowed slightly above 1 so hard efforts can push heart rate to its ceiling.
 */
export function relativeIntensity(
  speedKph: number,
  inclinePercent: number,
  profile: RunnerProfile,
): number {
  const cost = oxygenCost(speedKph, inclinePercent);
  const span = profile.vo2MaxMlPerKgPerMin - RESTING_VO2;
  if (span <= 0) return 0;
  return Math.min(1.05, Math.max(0, (cost - RESTING_VO2) / span));
}

/** Steady-state heart rate for a given effort. */
export function steadyStateHeartRate(intensity: number, profile: RunnerProfile): number {
  const span = profile.maxHeartRateBpm - profile.restingHeartRateBpm;
  return profile.restingHeartRateBpm + span * intensity;
}

/** Time constants for heart-rate drift. Recovery is slower than onset. */
const HEART_RATE_RISE_TAU_S = 22;
const HEART_RATE_FALL_TAU_S = 45;

/**
 * Advances heart rate toward its steady state with a first-order lag, so the
 * simulated trace ramps and recovers instead of snapping between values.
 */
export function advanceHeartRate(
  currentBpm: number,
  targetBpm: number,
  elapsedSeconds: number,
): number {
  const tau = targetBpm > currentBpm ? HEART_RATE_RISE_TAU_S : HEART_RATE_FALL_TAU_S;
  const response = 1 - Math.exp(-elapsedSeconds / tau);
  return currentBpm + (targetBpm - currentBpm) * response;
}
