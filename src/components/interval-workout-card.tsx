"use client";

import { useEffect, useRef } from "react";
import { Download, FolderOpen, ListPlus, Pause, Play, X } from "lucide-react";
import { toast } from "sonner";

import { IntervalWorkoutChart } from "@/components/interval-workout-chart";
import { MIN_BELT_SPEED_MPH, useIntervalWorkout } from "@/components/interval-workout-provider";
import { useWorkout } from "@/components/workout-provider";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toMachineSpeed } from "@/lib/ble/ftms/speed-units";
import { formatDuration } from "@/lib/format";
import { IntervalWorkoutFileError, parseIntervalWorkoutFile } from "@/lib/intervals/serialize";

/** Marks a `postMessage` as coming from the interval builder popup rather
 *  than from anything else that might message this window — checked
 *  alongside the message's `event.source`/`event.origin`, not instead of
 *  them (see the listener in `IntervalWorkoutCard` below). */
const BUILDER_MESSAGE_SOURCE = "treadlogger-interval-mockup";

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
 *
 * "Create workout" opens `/interval-builder-mockup.html` (a static page in
 * `public/`, not a React component) in a sized popup window, rather than
 * rendering an in-app builder. That file *is* the original standalone
 * interaction-design mockup — full pointer-driven drag-to-reorder, drag-to-
 * delete, drag-to-duplicate, the works — kept alive as plain HTML/JS instead
 * of re-implemented in React a second time, after the from-scratch React
 * port (`interval-builder.tsx`, still in the repo but no longer used here)
 * turned out to have quietly dropped enough of that interaction fidelity
 * that it was worth going back to the source rather than continuing to
 * patch the port. The popup posts the finished plan back to this window
 * with `postMessage` when its own Save button is clicked (or downloads a
 * `.treadlogger.json` instead, if it isn't a popup this window opened — see
 * the mockup file's own comments) — `handleBuilderMessage` below is the
 * receiving end, validated through the same `parseIntervalWorkoutFile` a
 * loaded file goes through, not trusted as-is.
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  // The popup window opened for "Create workout", so a second click can
  // just refocus it instead of opening a duplicate, and so the message
  // listener below can check `event.source` against something more
  // specific than "any window that happens to message us".
  const builderWindowRef = useRef<Window | null>(null);

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

  // Receives the finished plan (or a cancel) from the builder popup. Two
  // checks beyond the message's own declared `source` field: `event.origin`
  // must be this same site (the popup is same-origin, served from our own
  // `public/`, so anything else is not it), and `event.source` must be
  // *this specific* popup window, not just any window — a page can only
  // ever message windows it has a reference to, so this also naturally
  // ignores messages after the ref's been reused for a newer popup.
  useEffect(() => {
    function handleBuilderMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!builderWindowRef.current || event.source !== builderWindowRef.current) return;

      const data = event.data as { source?: unknown; type?: unknown; workout?: unknown } | null;
      if (!data || data.source !== BUILDER_MESSAGE_SOURCE) return;

      if (data.type === "save") {
        try {
          // The popup builds a plausible-looking object, but it's still a
          // separate, hand-rolled bit of JS reaching in through
          // `postMessage` — parsed and validated the same way a loaded
          // `.treadlogger.json` file is, not trusted as already-correct.
          const parsed = parseIntervalWorkoutFile(JSON.stringify(data.workout));
          setPlan(parsed);
          toast.success("Interval workout saved", { description: parsed.name });
        } catch (error) {
          toast.error("Could not use that workout", {
            description:
              error instanceof IntervalWorkoutFileError || error instanceof Error
                ? error.message
                : String(error),
          });
        }
      }
      // Either a save or a cancel means the popup is closing itself.
      builderWindowRef.current = null;
    }

    window.addEventListener("message", handleBuilderMessage);
    return () => window.removeEventListener("message", handleBuilderMessage);
  }, [setPlan]);

  const openBuilder = () => {
    if (builderWindowRef.current && !builderWindowRef.current.closed) {
      builderWindowRef.current.focus();
      return;
    }
    // The mockup's own CSS has two width-gated upgrades, both in
    // `public/interval-builder-mockup.html`: past 560px it becomes a
    // rounded, shadowed "floating card" with scrolling contained inside
    // itself instead of the whole page scrolling under the browser's own
    // bold default scrollbar; past 900px it stops being a stretched-out
    // phone screenshot and switches to an actual desktop layout — the plan
    // (templates + block list) and the composer side by side, wide enough
    // for the composer's own Work/Rest fields to also go side by side
    // rather than fully stacked (by far the tallest thing on this page).
    // 1150×900 comfortably clears both, with room for the popup window's
    // own chrome.
    const win = window.open(
      "/interval-builder-mockup.html",
      "treadlogger-interval-builder",
      "width=1150,height=900,resizable=yes,scrollbars=yes",
    );
    if (!win) {
      toast.error("Couldn't open the workout builder", {
        description: "Your browser may have blocked the popup — check its address bar for a blocked-popup notice.",
      });
      return;
    }
    // Belt-and-braces: a window.open() call that reuses an *existing*
    // same-named window (left open from a previous click, possibly at
    // whatever size the user last dragged it to) ignores the size in the
    // features string above in some browsers — only a brand-new window
    // reliably picks it up. resizeTo() forces it either way; wrapped in
    // try/catch since a handful of older/locked-down browsers restrict it
    // even for script-opened windows, and this is a nicety, not something
    // worth surfacing an error over if it's unavailable.
    try {
      win.resizeTo(1150, 900);
    } catch {
      // ignore — the popup still works at whatever size it already has
    }
    builderWindowRef.current = win;
  };

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

          <Button type="button" variant="outline" onClick={openBuilder}>
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
