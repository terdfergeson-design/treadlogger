"use client";

import { Flame, Gauge, Heart, Mountain, Route, Timer, TrendingUp, Zap } from "lucide-react";

import { MetricTile } from "@/components/metric-tile";
import { useWorkout } from "@/components/workout-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCalories,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatIncline,
  formatPace,
  formatSpeed,
} from "@/lib/format";

const STATE_BADGE = {
  idle: { label: "Ready", className: "" },
  active: { label: "Recording", className: "bg-primary/15 text-primary border-primary/30" },
  paused: { label: "Paused", className: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400" },
  finished: { label: "Finished", className: "" },
} as const;

export function LiveDashboard() {
  const { workout, heartRate, treadmill } = useWorkout();

  const distance = formatDistance(workout.distanceM);
  const badge = STATE_BADGE[workout.state];
  const liveHeartRate = heartRate.measurement?.heartRateBpm ?? workout.heartRateBpm;
  const liveSpeed = workout.state === "idle" ? treadmill.data.speedKph : workout.speedKph;
  const liveIncline = treadmill.data.inclinationPercent ?? workout.inclinePercent;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Live metrics</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={badge.className}>
              {badge.label}
            </Badge>
            {workout.samples.length > 0 ? (
              <span className="text-muted-foreground hidden text-xs sm:inline">
                {workout.samples.length.toLocaleString()}{" "}
                {workout.samples.length === 1 ? "sample" : "samples"} logged
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            label="Time"
            value={formatDuration(workout.elapsedS)}
            icon={Timer}
            emphasis
          />
          <MetricTile
            label="Distance"
            value={distance.value}
            unit={distance.unit}
            icon={Route}
            emphasis
          />
          <MetricTile
            label="Speed"
            value={formatSpeed(liveSpeed)}
            unit="km/h"
            icon={Gauge}
            emphasis
          />
          <MetricTile
            label="Heart rate"
            value={formatHeartRate(liveHeartRate)}
            unit="bpm"
            icon={Heart}
            emphasis
            valueClassName={liveHeartRate ? "text-rose-500" : undefined}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile label="Pace" value={formatPace(workout.paceMinPerKm)} unit="/km" icon={Zap} />
          <MetricTile
            label="Incline"
            value={formatIncline(liveIncline)}
            unit="%"
            icon={TrendingUp}
          />
          <MetricTile
            label="Calories"
            value={formatCalories(workout.energyKcal)}
            unit="kcal"
            icon={Flame}
          />
          <MetricTile
            label="Elevation"
            value={Math.round(workout.elevationGainM).toString()}
            unit="m"
            icon={Mountain}
          />
        </div>

        <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 pt-1 text-xs sm:grid-cols-4">
          <SecondaryStat label="Avg speed" value={`${formatSpeed(workout.avgSpeedKph)} km/h`} />
          <SecondaryStat label="Max speed" value={`${formatSpeed(workout.maxSpeedKph)} km/h`} />
          <SecondaryStat label="Avg pace" value={`${formatPace(workout.avgPaceMinPerKm)} /km`} />
          <SecondaryStat
            label="Avg / max HR"
            value={`${formatHeartRate(workout.avgHeartRateBpm)} / ${formatHeartRate(workout.maxHeartRateBpm)} bpm`}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:justify-start sm:gap-0">
      <dt>{label}</dt>
      <dd className="text-foreground font-mono tabular-nums">{value}</dd>
    </div>
  );
}
