"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useWorkout } from "@/components/workout-provider";
import { fromMachineSpeed } from "@/lib/ble/ftms/speed-units";
import { downloadIntervalWorkoutFile, readIntervalWorkoutFile } from "@/lib/intervals/file";
import { IntervalWorkoutFileError } from "@/lib/intervals/serialize";
import { buildTimeline, segmentAt, timelineTotalSec, type TimelineSegment } from "@/lib/intervals/timeline";
import type { IntervalWorkoutFile } from "@/lib/intervals/types";

/**
 * Owns the loaded interval workout plan and, once a run has been started,
 * drives it forward.
 *
 * Deliberately a separate provider from `WorkoutProvider` rather than more
 * fields bolted onto it: this is a layer *on top of* an ordinary workout
 * (loading a plan, or following one) rather than part of what a workout
 * fundamentally is, and `WorkoutProvider` is already the thing every other
 * card depends on. It does need to sit inside `WorkoutProvider` in the tree,
 * though, since following a plan means reading the workout's own timer and
 * the treadmill's own live data, and calling back into
 * `setTargetSpeed`/`setTargetIncline`.
 *
 * An interval run is something a runner opts into *after* a workout is
 * already under way, once the belt is actually moving — see `isBeltReady`
 * below — rather than a separate way of starting one. That also means the
 * plan's own clock has to start counting from whenever the run actually
 * begins, not from the workout's own t=0: see `elapsedInPlanSec` below.
 *
 * There used to be a manual mode (track progress against the plan without
 * touching the treadmill) alongside this automatic one; it was removed as a
 * choice nobody used — every run now drives the belt. Progress is still
 * driven off `workout.elapsedS` — the recorder's own timer, which already
 * excludes paused time — rather than a wall clock this provider would have
 * to pause and resume itself. That's what makes "resume from the same spot"
 * mostly free: elapsedS simply stops advancing while paused. The one thing
 * elapsedS alone doesn't cover is the treadmill's own restart routine after
 * a resume (this machine does its own countdown and ramps up from a fixed
 * 0.5 mph, same as at the very start of a workout — see STARTING_SPEED_KPH
 * in workout-provider.tsx) — elapsedS resumes ticking the instant the
 * recorder does, well before the belt is actually back up to speed. See
 * `isBeltReady` for how that gap is covered.
 *
 * A runner can also hand control back to themselves mid-run without ending
 * it — `isPaused` below, toggled by `pauseIntervalRun`/`resumeIntervalRun`.
 * This is deliberately not the same thing as pausing the *workout*: the
 * treadmill keeps moving and the workout keeps recording, only the
 * automatic driving (and the plan's own progress) is on hold, using the
 * same offset-freezing trick `isBeltReady` uses below — see the freeze
 * effect.
 *
 * While paused, a runner can also drag the plan's cursor to a different
 * point on the timeline before resuming — `seekIntervalRun` below, backed by
 * `pausedSeekSec`. This only ever changes where a *later* resume picks the
 * plan back up from; it doesn't touch the treadmill or the workout's own
 * clock while paused (the segment-driving effect stands down entirely
 * during a pause, same as before), so scrubbing around and changing your
 * mind costs nothing. `resumeIntervalRun` is what actually commits the
 * scrubbed position, re-anchoring the frozen offset to it.
 */

/** The belt has to be actually moving, not just commanded to — a runner
 *  stepping onto a treadmill mid-countdown, or a belt still ramping up
 *  after a resume, hasn't started the segment yet. This treadmill's own
 *  fixed starting speed is 0.5 mph (see STARTING_SPEED_KPH in
 *  workout-provider.tsx); 0.3 mph is set a little below that so the gate
 *  trips as soon as the belt is unmistakably moving, rather than waiting on
 *  the exact starting speed to be hit (which can read a tick low or high
 *  depending on the sensor's rounding). */
export const MIN_BELT_SPEED_MPH = 0.3;
const MIN_BELT_SPEED_KPH = fromMachineSpeed(MIN_BELT_SPEED_MPH, "mph");

/** How long the belt has to hold at least MIN_BELT_SPEED_MPH, continuously,
 *  before treating it as actually up and running rather than a momentary
 *  blip mid-ramp. Chosen over a fixed wait after start/resume because it
 *  reacts to what the belt is actually doing — a slow-to-respond machine or
 *  a runner who pauses again immediately both just keep this from flipping,
 *  rather than the app guessing a delay and being wrong in one direction or
 *  the other. */
export const MIN_BELT_STABLE_MS = 2_000;

interface IntervalWorkoutContextValue {
  plan: IntervalWorkoutFile | null;
  timeline: TimelineSegment[];
  totalSec: number;

  loadPlanFile: (file: File) => Promise<void>;
  setPlan: (workout: IntervalWorkoutFile) => void;
  clearPlan: () => void;
  downloadPlan: () => void;

  /** Whether the loaded plan is currently being followed (and, since this
   *  provider only ever drives automatically, currently commanding the
   *  treadmill). Stays true across a pause/resume, across a manual pause
   *  (see `isPaused`), and after the workout finishes — see the class
   *  comment and `elapsedInPlanSec` below. */
  isRunning: boolean;
  /** Whether the belt has been at or above `MIN_BELT_SPEED_MPH` for at
   *  least `MIN_BELT_STABLE_MS`, continuously, right now. True immediately
   *  when no treadmill is connected at all — there's no belt to wait on in
   *  that case. Gates both starting a run and, after a pause/resume,
   *  resuming the plan's own clock (see the freeze effect below). */
  isBeltReady: boolean;
  /** Whether the runner has manually taken the belt off autopilot mid-run
   *  (see `pauseIntervalRun`). Only meaningful while `isRunning`. The
   *  treadmill keeps running under the runner's own manual controls and the
   *  workout keeps recording — only the plan's own progress and the
   *  automatic speed/incline commands are on hold. */
  isPaused: boolean;
  /** Whether `beginIntervalRun` would actually do anything right now — a
   *  plan is loaded, no run is already in progress, the workout is active,
   *  and `isBeltReady`. */
  canStartRun: boolean;
  /** Whether `pauseIntervalRun` would actually do anything right now — a
   *  run is in progress, not already paused, and the workout is active. */
  canPauseRun: boolean;
  /** Whether `resumeIntervalRun` would actually do anything right now — a
   *  run is in progress, manually paused, and the workout is active. */
  canResumeRun: boolean;
  /** Begins following the loaded plan from *this* moment — not from the
   *  workout's own start. No-op if `canStartRun` is false. */
  beginIntervalRun: () => void;
  /** Hands the belt back to the runner's own manual controls without
   *  ending the run — the workout and the treadmill keep going, only the
   *  automatic driving stops. No-op if `canPauseRun` is false. */
  pauseIntervalRun: () => void;
  /** Hands the belt back to the plan, re-issuing the current segment's
   *  speed/incline (overriding whatever the runner set manually) and
   *  letting the plan's clock advance again — from wherever `seekIntervalRun`
   *  last scrubbed to, if anywhere, or otherwise from the point it was
   *  paused at. No-op if `canResumeRun` is false. */
  resumeIntervalRun: () => void;
  /** While paused, moves the plan's displayed cursor to `sec` (clamped to
   *  the plan's length) without touching the treadmill or the workout's
   *  clock — purely a preview of where `resumeIntervalRun` would pick back
   *  up. No-op unless `canResumeRun` is true (i.e. unless a resume would
   *  otherwise be valid right now). */
  seekIntervalRun: (sec: number) => void;

  /** The segment that should be current right now, or undefined if no plan
   *  is loaded. Kept live even when `isRunning` is false, so the chart can
   *  show "what would be playing" before a run starts. */
  activeSegment: TimelineSegment | undefined;
  /** Seconds into the plan, or null when no run is in progress. */
  elapsedInPlanSec: number | null;
}

const IntervalWorkoutContext = createContext<IntervalWorkoutContextValue | null>(null);

export function IntervalWorkoutProvider({ children }: { children: React.ReactNode }) {
  const { workout, treadmill, setTargetSpeed, setTargetIncline } = useWorkout();

  const [plan, setPlanState] = useState<IntervalWorkoutFile | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isBeltReady, setIsBeltReady] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // Where a manual pause has been dragged to on the timeline, in plan
  // seconds — null while not scrubbed (in which case the display just shows
  // the frozen pause point, as before). Only ever read while isPaused;
  // reset to null everywhere isPaused itself gets reset to false, plus on
  // every fresh pause, so a stale scrub from a previous pause never leaks
  // into the next one.
  const [pausedSeekSec, setPausedSeekSec] = useState<number | null>(null);

  const timeline = useMemo(() => buildTimeline(plan?.blocks ?? []), [plan]);
  const totalSec = useMemo(() => timelineTotalSec(timeline), [timeline]);

  // The segment index last sent to the treadmill, so a steady segment that
  // spans many ticks issues one command, not one per second. Reset whenever
  // a new run starts.
  const lastAppliedIndexRef = useRef(-1);

  // workout.elapsedS at the instant the run began, so the plan's own clock
  // reads 0 from there rather than from the workout's actual start — the
  // run can begin well after the workout did. Also nudged forward while the
  // belt isn't ready (see the freeze effect below), which is what pauses
  // the plan's clock across a resume without a second, separate stopwatch.
  const runStartElapsedSecRef = useRef(0);

  // Which workout (by its startedAt stamp) the current run belongs to. See
  // the reset effect below.
  const runWorkoutStartedAtRef = useRef<number | undefined>(undefined);

  // The plan-second elapsedInPlanSec was pinned to when the current freeze
  // began (belt not ready, or manually paused), or null while not frozen.
  // See the freeze effect below for why this needs to be captured once,
  // rather than recomputed from scratch on every tick.
  const frozenAtSecRef = useRef<number | null>(null);

  // The moment the belt's speed most recently crossed up through
  // MIN_BELT_SPEED_MPH, or null while it's below that. Read by the effect
  // just below; not itself exposed.
  const beltAboveThresholdSinceRef = useRef<number | null>(null);

  // Tracks whether the belt has been continuously at or above
  // MIN_BELT_SPEED_MPH for MIN_BELT_STABLE_MS. Runs off the treadmill's own
  // live data, not the recorder's, so it reflects the real machine — a
  // workout can be "active" while the belt is still mid-countdown or
  // ramping back up after a pause, in this treadmill's own restart routine.
  // Scheduled with setTimeout rather than polled: if speedKph doesn't
  // change again for the full window (a steady reading with no new BLE
  // notification), the timer still fires on its own on schedule.
  useEffect(() => {
    if (treadmill.connection !== "connected") {
      beltAboveThresholdSinceRef.current = null;
      setIsBeltReady(true);
      return;
    }

    const speedKph = treadmill.data.speedKph;
    const aboveThreshold = speedKph !== undefined && speedKph >= MIN_BELT_SPEED_KPH;

    if (!aboveThreshold) {
      beltAboveThresholdSinceRef.current = null;
      setIsBeltReady(false);
      return;
    }

    const since = beltAboveThresholdSinceRef.current ?? Date.now();
    beltAboveThresholdSinceRef.current = since;

    const elapsedMs = Date.now() - since;
    if (elapsedMs >= MIN_BELT_STABLE_MS) {
      setIsBeltReady(true);
      return;
    }

    const timer = setTimeout(() => setIsBeltReady(true), MIN_BELT_STABLE_MS - elapsedMs);
    return () => clearTimeout(timer);
  }, [treadmill.connection, treadmill.data.speedKph]);

  // While paused with a scrub in progress, the scrubbed position previews
  // as the plan's position instead of the frozen pause point — purely a
  // display override, since the segment-driving effect already stands down
  // entirely while paused and so never sees this value.
  //
  // While frozen (belt-gate or manual pause) but not scrubbed, this reads
  // `frozenAtSecRef.current` directly rather than going through
  // `workout.elapsedS - runStartElapsedSecRef.current` the way the
  // non-frozen case below does. That indirection is what the freeze
  // *effect* keeps in sync so a later unfreeze can pick back up smoothly,
  // but an effect only runs after a render has already committed — so on
  // every tick during a freeze, this component would otherwise render once
  // using the *previous* tick's runStartElapsedSecRef (the effect for the
  // current tick hasn't run yet), which comes out to frozenAtSec plus that
  // tick's own delta instead of frozenAtSec exactly. That's a real, visible
  // bug (a small but real jump immediately after freezing, "the cursor
  // keeps moving slightly when paused"), not just an off-by-one in this
  // comment: frozenAtSecRef itself has already been captured at the right
  // value the instant a freeze starts, so reading it straight from render
  // skips the effect-lag entirely and holds the display exactly constant
  // for the freeze's whole duration.
  const elapsedInPlanSec = isRunning
    ? isPaused && pausedSeekSec !== null
      ? pausedSeekSec
      : frozenAtSecRef.current !== null
        ? frozenAtSecRef.current
        : Math.max(0, workout.elapsedS - runStartElapsedSecRef.current)
    : null;
  const activeSegment = elapsedInPlanSec === null ? segmentAt(timeline, 0) : segmentAt(timeline, elapsedInPlanSec);

  const canStartRun = plan !== null && !isRunning && workout.state === "active" && isBeltReady;
  const canPauseRun = isRunning && !isPaused && workout.state === "active";
  const canResumeRun = isRunning && isPaused && workout.state === "active";

  // A workout's identity is its startedAt stamp — a fresh one is minted by
  // both the ordinary idle -> active start and by "Start another workout"
  // (which goes straight from finished to active, skipping idle entirely),
  // and cleared back to undefined by a discard. Any time the current
  // workout's stamp no longer matches the one the active run was armed
  // for, that run belongs to a workout that is no longer this one, so it
  // stops — without this, "Start another workout" after a plan run would
  // silently carry the run over onto a plain freeform workout the runner
  // never asked it to follow.
  useEffect(() => {
    if (isRunning && workout.startedAt !== runWorkoutStartedAtRef.current) {
      setIsRunning(false);
      setIsPaused(false);
      setPausedSeekSec(null);
      lastAppliedIndexRef.current = -1;
      frozenAtSecRef.current = null;
    }
  }, [workout.startedAt, isRunning]);

  // Freezes the plan's own clock whenever it shouldn't be advancing: while
  // the workout is active but the belt isn't confirmed up to speed yet (the
  // window right after a resume where the treadmill is doing its own
  // restart countdown and ramp from 0.5 mph), or while the runner has
  // manually paused the *interval* — see `isPaused` — and is driving the
  // belt themselves. workout.elapsedS keeps ticking through both of those
  // windows (the recorder itself only pauses for an actual workout pause,
  // not either of these), so without this a runner would lose however much
  // time either window took off of whatever segment they were in.
  //
  // The first tick of a freeze captures the plan-second it began at
  // (`frozenAtSecRef`); every tick after that recomputes the offset as
  // `elapsedS - frozenAtSec`, which is what actually holds elapsedInPlanSec
  // pinned at that value for as long as the freeze lasts — simply
  // re-assigning the offset to the raw elapsedS each tick (an earlier
  // version of this effect) collapses elapsedInPlanSec toward zero instead,
  // since the offset would then be advancing in lockstep with elapsedS from
  // a moving target rather than a fixed one. Once both conditions clear,
  // `frozenAtSecRef` resets to null and the offset is simply left where the
  // last frozen tick put it, so the plan clock picks up again from exactly
  // that frozen point with no further adjustment needed.
  useEffect(() => {
    if (!isRunning) return;
    if (workout.state !== "active") return;

    if (isBeltReady && !isPaused) {
      frozenAtSecRef.current = null;
      return;
    }

    if (frozenAtSecRef.current === null) {
      frozenAtSecRef.current = Math.max(0, workout.elapsedS - runStartElapsedSecRef.current);
    }
    runStartElapsedSecRef.current = workout.elapsedS - frozenAtSecRef.current;
  }, [isRunning, workout.state, workout.elapsedS, isBeltReady, isPaused]);

  // Whenever the plan advances into a new segment, push its speed and
  // incline to the treadmill. Keyed on elapsedS so it re-checks every
  // sample tick, but only actually commands the belt when the active
  // segment's index has changed since the last command — which also means
  // it naturally does nothing while the freeze effect above is holding
  // elapsedInPlanSec (and so activeSegment) still. Also stands down
  // entirely while manually paused, so it doesn't fight the runner's own
  // manual speed/incline changes.
  useEffect(() => {
    if (!isRunning) return;
    if (isPaused) return;
    if (workout.state !== "active") return;
    if (!activeSegment) return;
    if (activeSegment.index === lastAppliedIndexRef.current) return;

    lastAppliedIndexRef.current = activeSegment.index;
    void setTargetSpeed(fromMachineSpeed(activeSegment.speedMph, "mph"));
    void setTargetIncline(activeSegment.inclinePercent);
  }, [isRunning, isPaused, workout.state, activeSegment, setTargetSpeed, setTargetIncline]);

  const loadPlanFile = useCallback(async (file: File) => {
    try {
      const loaded = await readIntervalWorkoutFile(file);
      setPlanState(loaded);
      toast.success("Interval workout loaded", { description: loaded.name });
    } catch (error) {
      toast.error("Could not load that interval workout", {
        description:
          error instanceof IntervalWorkoutFileError || error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }, []);

  const setPlan = useCallback((workoutFile: IntervalWorkoutFile) => {
    setPlanState(workoutFile);
  }, []);

  const clearPlan = useCallback(() => {
    setPlanState(null);
    setIsRunning(false);
    setIsPaused(false);
    setPausedSeekSec(null);
    lastAppliedIndexRef.current = -1;
    frozenAtSecRef.current = null;
  }, []);

  const downloadPlan = useCallback(() => {
    if (!plan) return;
    downloadIntervalWorkoutFile(plan);
    toast.success("Interval workout saved", { description: plan.name });
  }, [plan]);

  const beginIntervalRun = useCallback(() => {
    if (!plan || timeline.length === 0) return;
    if (isRunning) return;
    if (workout.state !== "active") return;
    if (!isBeltReady) return;

    runStartElapsedSecRef.current = workout.elapsedS;
    runWorkoutStartedAtRef.current = workout.startedAt;
    lastAppliedIndexRef.current = -1;
    frozenAtSecRef.current = null;
    setIsPaused(false);
    setPausedSeekSec(null);
    setIsRunning(true);
  }, [plan, timeline.length, isRunning, workout.state, isBeltReady, workout.elapsedS, workout.startedAt]);

  const pauseIntervalRun = useCallback(() => {
    if (!isRunning || isPaused) return;
    if (workout.state !== "active") return;
    setPausedSeekSec(null);
    setIsPaused(true);
  }, [isRunning, isPaused, workout.state]);

  const resumeIntervalRun = useCallback(() => {
    if (!isRunning || !isPaused) return;
    if (workout.state !== "active") return;
    // Pick up from wherever the runner scrubbed to, if anywhere, otherwise
    // from the point the freeze effect has been holding since the pause
    // began. Re-anchoring both refs here (rather than leaving it to the
    // freeze effect to notice on its next tick) means the very first render
    // after resuming already reflects the scrubbed position, not whatever
    // was frozen a moment before.
    const resumeAtSec =
      pausedSeekSec !== null ? pausedSeekSec : Math.max(0, workout.elapsedS - runStartElapsedSecRef.current);
    frozenAtSecRef.current = resumeAtSec;
    runStartElapsedSecRef.current = workout.elapsedS - resumeAtSec;
    // Force the next tick of the segment-driving effect to reissue the
    // current segment's speed/incline even though its index may not have
    // changed — the runner may have set the belt to something else while
    // driving manually, or scrubbed to a different segment entirely, and
    // resuming should hand it back to the plan's actual target for wherever
    // it's resuming from, not leave whatever they last set in place.
    lastAppliedIndexRef.current = -1;
    setPausedSeekSec(null);
    setIsPaused(false);
  }, [isRunning, isPaused, workout.state, pausedSeekSec, workout.elapsedS]);

  const seekIntervalRun = useCallback(
    (sec: number) => {
      if (!isRunning || !isPaused) return;
      if (workout.state !== "active") return;
      if (!Number.isFinite(sec)) return;
      setPausedSeekSec(Math.max(0, Math.min(sec, totalSec)));
    },
    [isRunning, isPaused, workout.state, totalSec],
  );

  const value = useMemo<IntervalWorkoutContextValue>(
    () => ({
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
    }),
    [
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
    ],
  );

  return <IntervalWorkoutContext.Provider value={value}>{children}</IntervalWorkoutContext.Provider>;
}

export function useIntervalWorkout(): IntervalWorkoutContextValue {
  const value = useContext(IntervalWorkoutContext);
  if (!value) throw new Error("useIntervalWorkout must be used inside an IntervalWorkoutProvider");
  return value;
}
