import { fromMachineSpeed } from "../ble/ftms/speed-units";
import { METRES_PER_FOOT } from "../format";
import type { IntervalLeg, SingleSegmentType, WorkoutBlock } from "./types";

/**
 * Flattens a workout's blocks into a single timeline of concrete segments —
 * each with an absolute start/end time, a target speed and incline, and a
 * label — so the chart, the run-progress cursor, and the automatic-mode
 * treadmill driver can all share one notion of "what should be happening at
 * second N" instead of re-walking the block list three different ways.
 *
 * A `single` block with `reps > 1` expands into that many identical
 * back-to-back segments (each individually labeled "n/reps") rather than one
 * long segment, so a hand-edited file that repeats a steady block reads the
 * same as one written out longhand. An `interval` block expands into
 * `reps` alternating work/rest segment pairs.
 */

export type TimelineSegmentKind = SingleSegmentType | "work" | "rest";

export interface TimelineSegment {
  /** Position of this segment within the flattened timeline — stable across
   *  renders as long as the source blocks don't change, which is what lets
   *  the automatic-mode driver tell "still the same segment" from "advanced
   *  to the next one" without comparing object identity. */
  index: number;
  kind: TimelineSegmentKind;
  label: string;
  startSec: number;
  endSec: number;
  speedMph: number;
  inclinePercent: number;
  /** Which entry in the original `blocks` array this segment came from —
   *  lets a caller map a running segment back to the block that produced it. */
  blockIndex: number;
}

const SINGLE_LABELS: Record<SingleSegmentType, string> = {
  warmup: "Warm up",
  steady: "Steady",
  cooldown: "Cooldown",
};

function repLabel(base: string, rep: number, reps: number): string {
  return reps > 1 ? `${base} ${rep + 1}/${reps}` : base;
}

/** Builds the flat, absolute-time segment list a chart or a run driver can walk in order. */
export function buildTimeline(blocks: WorkoutBlock[]): TimelineSegment[] {
  const timeline: TimelineSegment[] = [];
  let cursorSec = 0;

  const push = (kind: TimelineSegmentKind, label: string, leg: IntervalLeg, blockIndex: number) => {
    timeline.push({
      index: timeline.length,
      kind,
      label,
      startSec: cursorSec,
      endSec: cursorSec + leg.durationSec,
      speedMph: leg.speedMph,
      inclinePercent: leg.inclinePercent,
      blockIndex,
    });
    cursorSec += leg.durationSec;
  };

  blocks.forEach((block, blockIndex) => {
    if (block.kind === "single") {
      for (let rep = 0; rep < block.reps; rep++) {
        push(
          block.type,
          repLabel(SINGLE_LABELS[block.type], rep, block.reps),
          { speedMph: block.speedMph, inclinePercent: block.inclinePercent, durationSec: block.durationSec },
          blockIndex,
        );
      }
    } else {
      for (let rep = 0; rep < block.reps; rep++) {
        push("work", repLabel("Work", rep, block.reps), block.work, blockIndex);
        push("rest", repLabel("Rest", rep, block.reps), block.rest, blockIndex);
      }
    }
  });

  return timeline;
}

/** Total planned duration — zero for an empty timeline rather than -Infinity. */
export function timelineTotalSec(timeline: TimelineSegment[]): number {
  if (timeline.length === 0) return 0;
  return timeline[timeline.length - 1].endSec;
}

/**
 * The segment that should be active at `elapsedSec`. Clamps to the first
 * segment before the plan starts and to the last segment once the plan has
 * run past its total duration, so a caller never has to special-case "the
 * plan just finished" separately from "still on the last segment" — holding
 * the final segment's targets is exactly the right behavior for automatic
 * mode once the runner has run past the end of a plan.
 */
export function segmentAt(timeline: TimelineSegment[], elapsedSec: number): TimelineSegment | undefined {
  if (timeline.length === 0) return undefined;
  if (elapsedSec < 0) return timeline[0];
  for (const segment of timeline) {
    if (elapsedSec < segment.endSec) return segment;
  }
  return timeline[timeline.length - 1];
}

/** A point on the plan's projected elevation profile: cumulative net climb,
 *  in feet, from the very start of the plan through `atSec`. */
export interface ElevationPoint {
  atSec: number;
  elevationFt: number;
}

/**
 * Projects the plan's cumulative climb from its speed and incline, using the
 * actual trigonometry rather than the small-angle "grade × distance"
 * shortcut a *live* recording uses (see `WorkoutRecorder`'s `altitudeM` in
 * `session.ts`, which treats the distance a runner covers as if it were the
 * horizontal run — a fine approximation at everyday treadmill inclines, but
 * not the calculation asked for here). The distance a runner actually
 * covers is measured along the belt's inclined surface — the hypotenuse of
 * the elevation triangle — not along the ground, so:
 *
 *   angle         = atan(inclinePercent / 100)   — grade -> the belt's slope angle
 *   beltDistanceM = speed × duration              — distance traveled along that slope
 *   riseM         = beltDistanceM × sin(angle)    — the vertical component of it
 *
 * Speed and incline are each constant within a segment, so the elevation
 * profile climbs in a straight line across it, not a step — at a steady
 * rate of speed × sin(angle) — which means only the value at each segment
 * boundary is needed; a caller connects them with straight lines to get the
 * full curve. Every plan segment currently has inclinePercent >= 0 (see the
 * builder's 0–20% stepper range), so this only ever climbs or holds level,
 * never descends.
 */
export function buildElevationProfile(timeline: TimelineSegment[]): ElevationPoint[] {
  const points: ElevationPoint[] = [{ atSec: 0, elevationFt: 0 }];
  let cumulativeM = 0;

  for (const segment of timeline) {
    const durationS = segment.endSec - segment.startSec;
    const speedMPerS = fromMachineSpeed(segment.speedMph, "mph") / 3.6;
    const angleRad = Math.atan(segment.inclinePercent / 100);
    const beltDistanceM = speedMPerS * durationS;
    cumulativeM += beltDistanceM * Math.sin(angleRad);
    points.push({ atSec: segment.endSec, elevationFt: cumulativeM / METRES_PER_FOOT });
  }

  return points;
}

/**
 * Interpolates the elevation profile at an arbitrary point in time — exact,
 * not an approximation, since the profile is genuinely piecewise-linear
 * between the breakpoints `buildElevationProfile` returns. Clamps before the
 * start and after the end the same way `segmentAt` does.
 */
export function elevationAtSec(profile: ElevationPoint[], atSec: number): number {
  if (profile.length === 0) return 0;
  if (atSec <= profile[0].atSec) return profile[0].elevationFt;

  for (let i = 1; i < profile.length; i++) {
    const curr = profile[i];
    if (atSec <= curr.atSec) {
      const prev = profile[i - 1];
      const span = curr.atSec - prev.atSec;
      const t = span > 0 ? (atSec - prev.atSec) / span : 0;
      return prev.elevationFt + t * (curr.elevationFt - prev.elevationFt);
    }
  }

  return profile[profile.length - 1].elevationFt;
}
