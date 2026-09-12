/**
 * Five-zone heart-rate model keyed off maximum heart rate.
 *
 * The percent-of-max boundaries are the common training-zone convention. Zones
 * are used for the live zone bar and for the time-in-zone breakdown on the
 * summary; they are not written into the FIT file, which carries raw samples.
 */

export interface HeartRateZone {
  index: 1 | 2 | 3 | 4 | 5;
  name: string;
  description: string;
  /** Inclusive lower bound as a fraction of maximum heart rate. */
  lowerFraction: number;
  /** Exclusive upper bound, except for zone 5 which has no ceiling. */
  upperFraction: number;
  /** Tailwind classes for the zone's accent colour. */
  barClass: string;
  textClass: string;
}

export const HEART_RATE_ZONES: readonly HeartRateZone[] = [
  {
    index: 1,
    name: "Zone 1",
    description: "Recovery",
    lowerFraction: 0.5,
    upperFraction: 0.6,
    barClass: "bg-sky-500",
    textClass: "text-sky-600 dark:text-sky-400",
  },
  {
    index: 2,
    name: "Zone 2",
    description: "Easy aerobic",
    lowerFraction: 0.6,
    upperFraction: 0.7,
    barClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  {
    index: 3,
    name: "Zone 3",
    description: "Tempo",
    lowerFraction: 0.7,
    upperFraction: 0.8,
    barClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-400",
  },
  {
    index: 4,
    name: "Zone 4",
    description: "Threshold",
    lowerFraction: 0.8,
    upperFraction: 0.9,
    barClass: "bg-orange-500",
    textClass: "text-orange-600 dark:text-orange-400",
  },
  {
    index: 5,
    name: "Zone 5",
    description: "VO2 max",
    lowerFraction: 0.9,
    upperFraction: Number.POSITIVE_INFINITY,
    barClass: "bg-rose-500",
    textClass: "text-rose-600 dark:text-rose-400",
  },
] as const;

/**
 * Returns the zone a reading falls into, or null when it sits below zone 1.
 * Anything under half of maximum heart rate is resting, not training.
 */
export function zoneForHeartRate(
  heartRateBpm: number,
  maxHeartRateBpm: number,
): HeartRateZone | null {
  if (maxHeartRateBpm <= 0) return null;
  const fraction = heartRateBpm / maxHeartRateBpm;

  for (let index = HEART_RATE_ZONES.length - 1; index >= 0; index -= 1) {
    if (fraction >= HEART_RATE_ZONES[index].lowerFraction) return HEART_RATE_ZONES[index];
  }

  return null;
}

export function zoneBoundsBpm(
  zone: HeartRateZone,
  maxHeartRateBpm: number,
): { lowerBpm: number; upperBpm: number | null } {
  return {
    lowerBpm: Math.round(zone.lowerFraction * maxHeartRateBpm),
    upperBpm: Number.isFinite(zone.upperFraction)
      ? Math.round(zone.upperFraction * maxHeartRateBpm)
      : null,
  };
}

/** Seconds accumulated in each zone, indexed 1-5. Index 0 holds sub-zone time. */
export type TimeInZones = Record<number, number>;

export function emptyTimeInZones(): TimeInZones {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}
