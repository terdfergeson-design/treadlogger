"use client";

import { useRef, useState } from "react";
import { Download, FolderOpen, ListPlus, Pause, Play, X } from "lucide-react";

import { IntervalBuilder } from "@/components/interval-builder";
import { IntervalWorkoutChart } from "@/components/interval-workout-chart";
import { MIN_BELT_SPEED_MPH, useIntervalWorkout } from "@/components/interval-workout-provider";
import { useWorkout } from "@/components/workout-provider";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toMachineSpeed } from "@/lib/ble/ftms/speed-units";
import { formatDuration } from "@/lib/format";

/**
 * Full-width card for planning and following a structured interval workout —
 * sits directly under the plain Start/Pause/Finish controls in
 * `workout-controls.tsx`.
 *
 * Starting an interval run is deliberately something a runner opts into
 * *after* the workout is already going and the belt is confirmed actually
 * moving (see `isBeltReady` in the provider), not an alternative way of
 * starting one — a runner uses the plain Start button same as always, waits
 * for the belt to come up to speed, then comes here and presses one button.
 * The same belt-speed check also covers resuming after a pause: this
 * treadmill re-runs its own startup countdown and ramp on every resume, not
 * just the very first start, so the plan's own clock waits out that window
 * too rather than losing however many seconds it takes to whatever segment
 * the runner resumed into. The run always drives the treadmill's speed and
 * incline itself as the plan advances — there used to be a manual choice to
 * just track progress instead, dropped as a distinction nobody used.
 *
 * A runner *can* still take the belt back mid-run, though, without ending
 * it: "Pause interval" hands control to the plain manual controls above
 * while the workout and the treadmill both keep going, and "Resume
 * interval" hands it back to the plan — see `isPaused` in the provider.
 * This is a different thing from pausing the *workout* (which this card
 * has no button for; that's still the plain Pause button above).
 *
 * While paused, the chart itself becomes a scrubber (see `seekable` on
 * `IntervalWorkoutChart`) so a runner can drag the cursor to a different
 * point on the plan before resuming — useful for skipping a segment they
 * don't want to do, or backing up to redo one. Dragging only changes where
 * the *next* resume picks up from; it doesn't move the treadmill or the
 * workout's clock by itself.
 */
export function IntervalWorkoutCard() {
  const { workout, treadmill } = useWorkout();
  const {
    plan,
    timeline,
    totalSec,
    loadPlanFile,
    setPlan,
    clearPlan,
    downloadPlan,
    isRunning,
    isBeltReady,
    isPaused,
    canStartRun,
    canPauseRun,
    canResumeRun,
    beginIntervalRun,
    pauseIntervalRun,
    resumeIntervalRun,
    seekIntervalRun,
    activeSegment,
    elapsedInPlanSec,
  } = useIntervalWorkout();

  const [builderOpen, setBuilderOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workoutRunning = workout.state === "active" || workout.state === "paused";
  const beltSpeedMph =
    treadmill.connection === "connected" && treadmill.data.speedKph !== undefined
      ? toMachineSpeed(treadmill.data.speedKph, "mph")
      : undefined;

  const handleFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void loadPlanFile(file);
  };

  if (builderOpen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Build an interval workout</CardTitle>
          <CardDescription>Add blocks one at a time, or start from a template below.</CardDescription>
        </CardHeader>
        <CardContent>
          <IntervalBuilder
            onSave={(workoutFile) => {
              setPlan(workoutFile);
              setBuilderOpen(false);
            }}
            onCancel={() => setBuilderOpen(false)}
          />
        </CardContent>
      </Card>
    );
  }

  // What "waiting on the belt" reads as wherever it shows up — before the
  // first start, and again during the freeze after a resume.
  const beltWaitingText =
    beltSpeedMph !== undefined
      ? `Belt at ${beltSpeedMph.toFixed(1)} mph — needs to hold ${MIN_BELT_SPEED_MPH.toFixed(1)} mph for a couple of seconds.`
      : `Waiting for the belt to reach ${MIN_BELT_SPEED_MPH.toFixed(1)} mph and hold it for a couple of seconds.`;

  // What to say under the start button while a run hasn't begun yet.
  const startHelperText = (() => {
    if (workout.state !== "active") {
      return "Start your workout, then come back here once the belt is up to speed.";
    }
    if (!isBeltReady) return beltWaitingText;
    return "Drives the treadmill's speed and incline for you as the plan advances.";
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interval workout</CardTitle>
        <CardDescription>
          {plan
            ? `${plan.name} · ${timeline.length} segment${timeline.length === 1 ? "" : "s"} · ${formatDuration(totalSec)} total`
            : "Load a saved plan, or build one from scratch."}
        </CardDescription>
        {plan && !workoutRunning ? (
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label="Clear loaded workout" onClick={clearPlan}>
              <X className="size-3.5" />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FolderOpen className="size-4" />
            Load workout
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChosen}
          />

          <Button type="button" variant="outline" onClick={() => setBuilderOpen(true)}>
            <ListPlus className="size-4" />
            Create workout
          </Button>

          <Button type="button" variant="outline" disabled={!plan} onClick={downloadPlan}>
            <Download className="size-4" />
            Download workout
          </Button>
        </div>

        {plan ? (
          <>
            <IntervalWorkoutChart
              timeline={timeline}
              totalSec={totalSec}
              elapsedInPlanSec={elapsedInPlanSec}
              activeSegment={activeSegment}
              seekable={isPaused}
              onSeek={seekIntervalRun}
            />

            {isRunning ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  {!workoutRunning
                    ? "This run has finished."
                    : isPaused
                      ? "Paused — driving manually. Drag the chart to change where you'll resume, or just resume to take back over from here."
                      : workout.state === "active" && !isBeltReady
                        ? `Resuming — ${beltWaitingText}`
                        : "Following this plan. Use the workout controls above to pause or finish."}
                </p>

                {workoutRunning ? (
                  isPaused ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={!canResumeRun}
                      onClick={resumeIntervalRun}
                    >
                      <Play className="size-4" />
                      Resume interval
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={!canPauseRun}
                      onClick={pauseIntervalRun}
                    >
                      <Pause className="size-4" />
                      Pause interval
                    </Button>
                  )
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Button type="button" className="w-full" disabled={!canStartRun} onClick={beginIntervalRun}>
                  <Play className="size-4" />
                  Start interval run
                </Button>

                <p className="text-muted-foreground text-[11px]">{startHelperText}</p>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
