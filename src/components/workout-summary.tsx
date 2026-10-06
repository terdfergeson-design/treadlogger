"use client";

import { useState } from "react";
import {
  CircleCheck,
  Download,
  FileDown,
  ImageDown,
  Loader2,
  Share2,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { HeartRateZones } from "@/components/heart-rate-zones";
import { ZoneSettingsPopover } from "@/components/runner-settings";
import { ShareCard } from "@/components/share-card";
import { useWorkout } from "@/components/workout-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatBytes } from "@/lib/fit/download";
import {
  formatCadence,
  formatCalories,
  formatClockTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPace,
  formatSpeed,
  paceUnitLabel,
  speedUnitLabel,
} from "@/lib/format";
import { saveShareCard, saveWorkoutScreenshot, SUMMARY_CAPTURE_ID } from "@/lib/screenshot/capture";

/** This app always displays in US customary units — see live-dashboard.tsx. */
const DISPLAY_UNIT = "mph";

/**
 * Post-workout summary and the FIT download.
 *
 * Split into two cards rather than one: only the first (header + headline
 * stats) carries `SUMMARY_CAPTURE_ID`, so the screenshot captured by
 * `saveWorkoutScreenshot` stops there — the heart rate zone breakdown and
 * the FIT/export controls below it are deliberately left out of the image.
 */
export function WorkoutSummary() {
  const { workout, encodedActivity, downloadActivity, maxHeartRateBpm, mode, discardWorkout } =
    useWorkout();
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [capturingShareCard, setCapturingShareCard] = useState(false);

  if (workout.state !== "finished" || workout.startedAt === undefined) return null;

  const distance = formatDistance(workout.distanceM);
  const verification = encodedActivity?.verification;
  const valid = verification?.isFit === true && verification.integrityOk;

  const downloadScreenshot = async () => {
    if (!encodedActivity) return;
    const fileName = encodedActivity.fileName.replace(/\.fit$/i, "") + ".png";
    setCapturingScreenshot(true);
    try {
      await saveWorkoutScreenshot(fileName);
      toast.success("Screenshot saved", { description: fileName });
    } catch (error) {
      toast.error("Could not save the screenshot", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCapturingScreenshot(false);
    }
  };

  const downloadShareCard = async () => {
    if (!encodedActivity) return;
    const fileName = encodedActivity.fileName.replace(/\.fit$/i, "") + "-card.png";
    setCapturingShareCard(true);
    try {
      await saveShareCard(fileName);
      toast.success("Share card saved", { description: fileName });
    } catch (error) {
      toast.error("Could not save the share card", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCapturingShareCard(false);
    }
  };

  return (
    <>
      {/* Off-screen; only exists to give saveShareCard something to capture. */}
      <ShareCard />

      <Card id={SUMMARY_CAPTURE_ID} className="border-primary/30">
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
            <div className="flex items-center gap-2">
              {mode === "simulator" ? (
                <Badge variant="secondary">Simulated workout</Badge>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear workout"
                title="Clear workout"
                onClick={discardWorkout}
                // Excluded from the screenshot/share-card capture (see
                // capture.ts's onclone-based tricks for the same idea) — this
                // is app chrome, not part of the run's record.
                data-html2canvas-ignore="true"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <SummaryStat label="Moving time" value={formatDuration(workout.elapsedS)} />
            <SummaryStat label="Distance" value={`${distance.value} ${distance.unit}`} />
            <SummaryStat label="Elevation gain" value={`${formatElevation(workout.elevationGainM)} ft`} />
            <SummaryStat
              label="Avg pace"
              value={`${formatPace(workout.avgPaceMinPerKm, DISPLAY_UNIT)} ${paceUnitLabel(DISPLAY_UNIT)}`}
            />
            <SummaryStat label="Avg cadence" value={`${formatCadence(workout.avgCadenceSpm)} spm`} />
            <SummaryStat label="Calories" value={`${formatCalories(workout.energyKcal)} kcal`} />
            <SummaryStat
              label="Avg speed"
              value={`${formatSpeed(workout.avgSpeedKph, DISPLAY_UNIT)} ${speedUnitLabel(DISPLAY_UNIT)}`}
            />
            <SummaryStat
              label="Max speed"
              value={`${formatSpeed(workout.maxSpeedKph, DISPLAY_UNIT)} ${speedUnitLabel(DISPLAY_UNIT)}`}
            />
            <SummaryStat label="Avg heart rate" value={`${formatHeartRate(workout.avgHeartRateBpm)} bpm`} />
            <SummaryStat label="Max heart rate" value={`${formatHeartRate(workout.maxHeartRateBpm)} bpm`} />
          </dl>
        </CardContent>
      </Card>

      <Card className="border-primary/30">
        <CardContent className="space-y-5">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Time in heart rate zones</h3>
              <ZoneSettingsPopover />
            </div>
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

            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                className="w-full sm:w-auto"
                disabled={!encodedActivity}
                onClick={downloadActivity}
              >
                <Download className="size-4" />
                Download FIT file
              </Button>

              <Button
                size="lg"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={!encodedActivity || capturingScreenshot}
                onClick={() => void downloadScreenshot()}
              >
                {capturingScreenshot ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImageDown className="size-4" />
                )}
                Download screenshot
              </Button>

              <Button
                size="lg"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={!encodedActivity || capturingShareCard}
                onClick={() => void downloadShareCard()}
              >
                {capturingShareCard ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                Share card
              </Button>
            </div>

            <p className="text-muted-foreground text-xs">
              &ldquo;Share card&rdquo; makes a square graphic with your distance and headline
              stats — sized for posting to Strava or Instagram, rather than a screenshot of this
              page.
            </p>

            <p className="text-muted-foreground text-xs">
              Encoded in the browser with Garmin&apos;s FIT SDK. Nothing is uploaded. Import it
              into Garmin Connect, Strava, intervals.icu or any tool that reads FIT activities.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
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
