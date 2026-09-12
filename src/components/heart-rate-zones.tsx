"use client";

import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  HEART_RATE_ZONES,
  zoneBoundsBpm,
  zoneForHeartRate,
  type TimeInZones,
} from "@/lib/workout/hr-zones";

/**
 * Zone breakdown.
 *
 * Doubles as a live indicator during a workout — where the current heart rate
 * sits — and as the time-in-zone summary afterwards.
 */
export function HeartRateZones({
  timeInZones,
  maxHeartRateBpm,
  currentBpm,
  className,
}: {
  timeInZones: TimeInZones;
  maxHeartRateBpm: number;
  currentBpm?: number;
  className?: string;
}) {
  const activeZone = currentBpm === undefined ? null : zoneForHeartRate(currentBpm, maxHeartRateBpm);
  const totalSeconds = HEART_RATE_ZONES.reduce(
    (total, zone) => total + (timeInZones[zone.index] ?? 0),
    0,
  );

  return (
    <div className={cn("space-y-2", className)}>
      {[...HEART_RATE_ZONES].reverse().map((zone) => {
        const seconds = timeInZones[zone.index] ?? 0;
        const share = totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;
        const { lowerBpm, upperBpm } = zoneBoundsBpm(zone, maxHeartRateBpm);
        const isActive = activeZone?.index === zone.index;

        return (
          <div key={zone.index} className="flex items-center gap-3">
            <div className="w-28 shrink-0 sm:w-36">
              <p
                className={cn(
                  "text-xs font-semibold",
                  isActive ? zone.textClass : "text-foreground",
                )}
              >
                {zone.name}
                {isActive ? " ·  now" : ""}
              </p>
              <p className="text-muted-foreground text-[11px]">
                {zone.description} · {lowerBpm}
                {upperBpm ? `–${upperBpm}` : "+"} bpm
              </p>
            </div>

            <div className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
              <div
                className={cn("h-full rounded-full transition-all duration-500", zone.barClass)}
                style={{ width: `${share}%` }}
              />
            </div>

            <span className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs tabular-nums">
              {seconds > 0 ? formatDuration(seconds) : "—"}
            </span>
          </div>
        );
      })}

      {totalSeconds === 0 ? (
        <p className="text-muted-foreground pt-1 text-xs">
          Zones fill in once a heart rate monitor is streaming during a workout.
        </p>
      ) : null}
    </div>
  );
}
