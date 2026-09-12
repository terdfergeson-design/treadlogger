"use client";

import { CircleCheck, Download, FileDown, TriangleAlert } from "lucide-react";

import { HeartRateZones } from "@/components/heart-rate-zones";
import { useWorkout } from "@/components/workout-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatBytes } from "@/lib/fit/download";
import {
  formatCalories,
  formatClockTime,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatPace,
  formatSpeed,
} from "@/lib/format";

/** Post-workout summary and the FIT download. */
export function WorkoutSummary() {
  const { workout, encodedActivity, downloadActivity, maxHeartRateBpm, mode } = useWorkout();

  if (workout.state !== "finished" || workout.startedAt === undefined) return null;

  const distance = formatDistance(workout.distanceM);
  const verification = encodedActivity?.verification;
  const valid = verification?.isFit === true && verification.integrityOk;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck className="text-primary size-5" />
              Workout complete
            </CardTitle>
            <CardDescription>
              {formatClockTime(workout.startedAt)} –{" "}
              {formatClockTime(workout.endedAt ?? workout.startedAt)} ·{" "}
              {workout.samples.length.toLocaleString()} samples recorded
            </CardDescription>
          </div>
          {mode === "simulator" ? (
            <Badge variant="secondary">Simulated workout</Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryStat label="Moving time" value={formatDuration(workout.elapsedS)} />
          <SummaryStat label="Distance" value={`${distance.value} ${distance.unit}`} />
          <SummaryStat label="Avg pace" value={`${formatPace(workout.avgPaceMinPerKm)} /km`} />
          <SummaryStat label="Calories" value={`${formatCalories(workout.energyKcal)} kcal`} />
          <SummaryStat label="Avg speed" value={`${formatSpeed(workout.avgSpeedKph)} km/h`} />
          <SummaryStat label="Max speed" value={`${formatSpeed(workout.maxSpeedKph)} km/h`} />
          <SummaryStat label="Avg heart rate" value={`${formatHeartRate(workout.avgHeartRateBpm)} bpm`} />
          <SummaryStat label="Max heart rate" value={`${formatHeartRate(workout.maxHeartRateBpm)} bpm`} />
        </dl>

        <div>
          <h3 className="mb-3 text-sm font-semibold">Time in heart rate zones</h3>
          <HeartRateZones timeInZones={workout.timeInZones} maxHeartRateBpm={maxHeartRateBpm} />
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <FileDown className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">FIT activity file</h3>
              {encodedActivity ? (
                <p className="text-muted-foreground truncate font-mono text-xs">
                  {encodedActivity.fileName} · {formatBytes(encodedActivity.bytes.byteLength)}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  The file could not be built. See the notification for details.
                </p>
              )}
            </div>
          </div>

          {verification ? (
            <div className="bg-muted/50 space-y-2 rounded-lg p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                {valid ? (
                  <>
                    <CircleCheck className="text-primary size-3.5" />
                    Decoded back and verified: valid FIT file, header and CRCs intact
                  </>
                ) : (
                  <>
                    <TriangleAlert className="text-destructive size-3.5" />
                    The encoded file did not pass verification
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(verification.messageCounts).map(([name, count]) => (
                  <Badge key={name} variant="outline" className="font-mono text-[11px]">
                    {name} × {count}
                  </Badge>
                ))}
              </div>
              {verification.errors.length > 0 ? (
                <p className="text-destructive text-xs">{verification.errors.join("; ")}</p>
              ) : null}
            </div>
          ) : null}

          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={!encodedActivity}
            onClick={downloadActivity}
          >
            <Download className="size-4" />
            Download FIT file
          </Button>

          <p className="text-muted-foreground text-xs">
            Encoded in the browser with Garmin&apos;s FIT SDK. Nothing is uploaded. Import it into
            Garmin Connect, Strava, intervals.icu or any tool that reads FIT activities.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="font-mono text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}
