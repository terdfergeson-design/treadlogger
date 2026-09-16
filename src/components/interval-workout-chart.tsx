"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { formatDuration } from "@/lib/format";
import {
  buildElevationProfile,
  elevationAtSec,
  type ElevationPoint,
  type TimelineSegment,
  type TimelineSegmentKind,
} from "@/lib/intervals/timeline";
import { cn } from "@/lib/utils";

/**
 * The interval plan's shape: speed, incline, and the climb they project,
 * over the course of the whole workout, plus (once a run is under way) a
 * cursor showing where the runner actually is.
 *
 * One chart with three lines, not the small-multiples layout
 * `workout-chart.tsx` uses for pace/elevation/heart rate — that layout
 * exists there specifically because those three are noisy,
 * independently-scaled *recordings*, and overlaying them would invent a
 * correlation the data doesn't have. Here speed, incline, and elevation are
 * all facets of one *plan*, all driven by the same block list, so one time
 * axis with a left axis (speed) and two stacked right axes (incline, then
 * elevation) is the natural extension of the standard structured-workout-
 * tool chart (Zwift, TrainerRoad). Speed and incline are drawn as step
 * functions, since a block's target is constant until the next block
 * starts; elevation is drawn as a straight climb across each segment
 * instead — see `buildElevationProfile` in `timeline.ts` for why that's
 * exact, not a smoothing choice. Colored bands behind the lines mark each
 * segment's kind (warmup/work/rest/steady/cooldown), the same coloring the
 * builder uses, so the plan's shape reads at a glance even before looking
 * at the numbers.
 *
 * While a caller passes `seekable` (the interval provider does this exactly
 * while manually paused — see `isPaused` there), the plot area itself
 * becomes a scrubber: click or drag anywhere on it, or focus it and use the
 * arrow/Home/End keys, to move the cursor and preview a different resume
 * point via `onSeek`. It's deliberately the whole plot that's draggable
 * rather than a small handle on the cursor dot — the dot itself is only a
 * couple of pixels wide once a run has been going for a while, and chasing
 * it precisely would be needlessly fiddly on a touch screen mid-run.
 */

const PLOT_W = 600;
const PLOT_H = 120;

const KIND_COLOR: Record<TimelineSegmentKind, { band: string; text: string }> = {
  warmup: { band: "fill-sky-500/10 dark:fill-sky-400/10", text: "text-sky-600 dark:text-sky-400" },
  work: { band: "fill-rose-500/12 dark:fill-rose-400/12", text: "text-rose-600 dark:text-rose-400" },
  rest: { band: "fill-emerald-500/12 dark:fill-emerald-400/12", text: "text-emerald-600 dark:text-emerald-400" },
  steady: { band: "fill-violet-500/10 dark:fill-violet-400/10", text: "text-violet-600 dark:text-violet-400" },
  cooldown: { band: "fill-blue-500/10 dark:fill-blue-400/10", text: "text-blue-600 dark:text-blue-400" },
};

function niceCeil(value: number, step: number): number {
  return Math.max(step, Math.ceil(value / step) * step);
}

/** Picks a round-numbered axis step for the elevation domain — a short flat
 *  workout might climb single-digit feet, a long hilly one hundreds, and a
 *  fixed step would either be too coarse for the first or too busy for the
 *  second. */
function elevationStep(maxFt: number): number {
  if (maxFt <= 20) return 5;
  if (maxFt <= 100) return 10;
  if (maxFt <= 500) return 50;
  return 100;
}

function valueToY(value: number, domainMax: number): number {
  const span = Math.max(1e-6, domainMax);
  return PLOT_H - (Math.min(value, domainMax) / span) * PLOT_H;
}

/**
 * A step-function line + area: flat across each segment, with a vertical
 * jump at every boundary — accurate for a plan, where the target is constant
 * until the instant the next block begins, unlike a smoothed or interpolated
 * line which would imply a ramp that isn't there.
 */
function buildStepPath(
  timeline: TimelineSegment[],
  totalSec: number,
  domainMax: number,
  valueOf: (segment: TimelineSegment) => number,
): { line: string; area: string } {
  if (timeline.length === 0 || totalSec <= 0) return { line: "", area: "" };

  const xOf = (t: number) => (t / totalSec) * PLOT_W;

  let line = "";
  timeline.forEach((segment, index) => {
    const y = valueToY(valueOf(segment), domainMax);
    const x1 = xOf(segment.startSec);
    const x2 = xOf(segment.endSec);
    line += index === 0 ? `M ${x1.toFixed(2)} ${y.toFixed(2)}` : ` L ${x1.toFixed(2)} ${y.toFixed(2)}`;
    line += ` L ${x2.toFixed(2)} ${y.toFixed(2)}`;
  });

  const area = `M ${xOf(0).toFixed(2)} ${PLOT_H} L ${line.slice(2)} L ${xOf(totalSec).toFixed(2)} ${PLOT_H} Z`;
  return { line, area };
}

/**
 * A straight-line path through the elevation profile's breakpoints — unlike
 * `buildStepPath`, this connects consecutive points directly rather than
 * jumping, since the climb genuinely progresses continuously across a
 * segment (see `buildElevationProfile`), not in a jump at its boundary.
 */
function buildLinePath(points: ElevationPoint[], totalSec: number, domainMax: number): { line: string; area: string } {
  if (points.length === 0 || totalSec <= 0) return { line: "", area: "" };

  const xOf = (t: number) => (t / totalSec) * PLOT_W;

  let line = "";
  points.forEach((point, index) => {
    const x = xOf(point.atSec);
    const y = valueToY(point.elevationFt, domainMax);
    line += index === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  const area = `M ${xOf(points[0].atSec).toFixed(2)} ${PLOT_H} L ${line.slice(2)} L ${xOf(points[points.length - 1].atSec).toFixed(2)} ${PLOT_H} Z`;
  return { line, area };
}

export function IntervalWorkoutChart({
  timeline,
  totalSec,
  elapsedInPlanSec,
  activeSegment,
  seekable = false,
  onSeek,
}: {
  timeline: TimelineSegment[];
  totalSec: number;
  elapsedInPlanSec: number | null;
  activeSegment: TimelineSegment | undefined;
  /** Whether the plot area should behave as a scrubber right now — true
   *  exactly while a caller wants dragging/clicking/arrow-keying it to move
   *  the cursor, e.g. while an interval run is manually paused. */
  seekable?: boolean;
  /** Called with a plan-second position (already clamped to [0, totalSec])
   *  as the runner drags, clicks, or arrow-keys the plot. Required when
   *  `seekable` is true; ignored otherwise. */
  onSeek?: (sec: number) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const secAtClientX = useCallback(
    (clientX: number) => {
      const el = plotRef.current;
      if (!el || totalSec <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const fraction = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      return Math.max(0, Math.min(totalSec, fraction * totalSec));
    },
    [totalSec],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!seekable || !onSeek) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      onSeek(secAtClientX(event.clientX));
    },
    [seekable, onSeek, secAtClientX],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !onSeek) return;
      onSeek(secAtClientX(event.clientX));
    },
    [isDragging, onSeek, secAtClientX],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!seekable || !onSeek || elapsedInPlanSec === null) return;
      const step = event.shiftKey ? 30 : 5;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onSeek(elapsedInPlanSec - step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onSeek(elapsedInPlanSec + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        onSeek(0);
      } else if (event.key === "End") {
        event.preventDefault();
        onSeek(totalSec);
      }
    },
    [seekable, onSeek, elapsedInPlanSec, totalSec],
  );
  const speedDomainMax = useMemo(
    () => niceCeil(Math.max(1, ...timeline.map((s) => s.speedMph)) * 1.15, 1),
    [timeline],
  );
  const inclineDomainMax = useMemo(
    () => niceCeil(Math.max(1, ...timeline.map((s) => s.inclinePercent)) * 1.15, 5),
    [timeline],
  );
  const elevationProfile = useMemo(() => buildElevationProfile(timeline), [timeline]);
  const elevationDomainMax = useMemo(() => {
    const maxFt = Math.max(1, ...elevationProfile.map((p) => p.elevationFt));
    return niceCeil(maxFt * 1.15, elevationStep(maxFt));
  }, [elevationProfile]);

  const speedPath = useMemo(
    () => buildStepPath(timeline, totalSec, speedDomainMax, (s) => s.speedMph),
    [timeline, totalSec, speedDomainMax],
  );
  const inclinePath = useMemo(
    () => buildStepPath(timeline, totalSec, inclineDomainMax, (s) => s.inclinePercent),
    [timeline, totalSec, inclineDomainMax],
  );
  const elevationPath = useMemo(
    () => buildLinePath(elevationProfile, totalSec, elevationDomainMax),
    [elevationProfile, totalSec, elevationDomainMax],
  );

  const xOf = (t: number) => (totalSec > 0 ? (t / totalSec) * PLOT_W : 0);
  const cursorX = elapsedInPlanSec !== null ? xOf(Math.min(elapsedInPlanSec, totalSec)) : null;
  const cursorSpeedY = elapsedInPlanSec !== null && activeSegment ? valueToY(activeSegment.speedMph, speedDomainMax) : null;
  const currentElevationFt = elapsedInPlanSec !== null ? elevationAtSec(elevationProfile, elapsedInPlanSec) : null;
  const cursorElevationY = currentElevationFt !== null ? valueToY(currentElevationFt, elevationDomainMax) : null;

  const xTicks = useMemo(() => {
    if (totalSec <= 0) return [];
    const tickCount = 5;
    return Array.from({ length: tickCount + 1 }, (_, i) => (totalSec / tickCount) * i);
  }, [totalSec]);

  const remainingSec = activeSegment && elapsedInPlanSec !== null ? Math.max(0, activeSegment.endSec - elapsedInPlanSec) : null;

  return (
    <div className="space-y-2">
      {activeSegment && elapsedInPlanSec !== null ? (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className={cn("font-semibold", KIND_COLOR[activeSegment.kind].text)}>
            {seekable ? "Resume from: " : "Now: "}
            {activeSegment.label} · {activeSegment.speedMph.toFixed(1)} mph · {activeSegment.inclinePercent.toFixed(0)}%
            {currentElevationFt !== null ? ` · ${Math.round(currentElevationFt)} ft climbed` : ""}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {seekable
              ? "Drag the chart to change"
              : remainingSec !== null
                ? `${formatDuration(remainingSec)} left in segment`
                : null}
          </span>
        </div>
      ) : null}

      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <span className="bg-primary inline-block size-2 rounded-full" />
          Speed (mph)
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-amber-500 dark:bg-amber-400" />
          Incline (%)
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-[#8b5e34] dark:bg-[#c99566]" />
          Elevation (ft)
        </span>
      </div>

      <div className="relative h-40 pl-9 pr-16">
        <div className="absolute inset-y-0 left-0 flex w-8 flex-col justify-between py-0.5 text-right">
          <span className="text-muted-foreground text-[9px] leading-none tabular-nums">
            {speedDomainMax.toFixed(0)}
          </span>
          <span className="text-muted-foreground text-[9px] leading-none tabular-nums">0</span>
        </div>
        <div className="absolute inset-y-0 right-8 flex w-8 flex-col justify-between py-0.5 text-left">
          <span className="text-amber-600 dark:text-amber-400 text-[9px] leading-none tabular-nums">
            {inclineDomainMax.toFixed(0)}%
          </span>
          <span className="text-amber-600 dark:text-amber-400 text-[9px] leading-none tabular-nums">0%</span>
        </div>
        <div className="absolute inset-y-0 right-0 flex w-8 flex-col justify-between py-0.5 text-left">
          <span className="text-[9px] leading-none tabular-nums text-[#8b5e34] dark:text-[#c99566]">
            {elevationDomainMax.toFixed(0)}
          </span>
          <span className="text-[9px] leading-none tabular-nums text-[#8b5e34] dark:text-[#c99566]">0</span>
        </div>

        {/* A second, un-padded relative box the same size as the plot itself —
         *  see the equivalent comment in workout-chart.tsx. The axis label
         *  columns above are positioned against the *outer* padded box (so
         *  they sit in the reserved gutters), while the SVG and the cursor
         *  dots live in this inner box so percentage-based positioning maps
         *  onto the plot area exactly, with no padding math to get wrong. */}
        <div
          ref={plotRef}
          className={cn("relative h-full w-full touch-none", seekable && "cursor-pointer")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          tabIndex={seekable ? 0 : undefined}
          role={seekable ? "slider" : undefined}
          aria-label={seekable ? "Resume position" : undefined}
          aria-valuemin={seekable ? 0 : undefined}
          aria-valuemax={seekable ? totalSec : undefined}
          aria-valuenow={seekable ? (elapsedInPlanSec ?? 0) : undefined}
          aria-valuetext={seekable && elapsedInPlanSec !== null ? formatDuration(elapsedInPlanSec) : undefined}
        >
          <svg
            viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label="Planned speed, incline, and projected elevation over the course of the workout"
          >
            {timeline.map((segment) => (
              <rect
                key={segment.index}
                x={xOf(segment.startSec)}
                y={0}
                width={Math.max(0, xOf(segment.endSec) - xOf(segment.startSec))}
                height={PLOT_H}
                className={KIND_COLOR[segment.kind].band}
              />
            ))}

            <path d={speedPath.area} stroke="none" className="fill-primary/10" />
            <path
              d={speedPath.line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-primary"
            />
            <path
              d={inclinePath.line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-amber-500 dark:stroke-amber-400"
            />
            <path
              d={elevationPath.line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-[#8b5e34] dark:stroke-[#c99566]"
            />

            {cursorX !== null ? (
              <line
                x1={cursorX}
                y1={0}
                x2={cursorX}
                y2={PLOT_H}
                vectorEffect="non-scaling-stroke"
                strokeWidth={seekable ? 2 : 1.5}
                strokeDasharray={seekable ? "3 2" : undefined}
                className={cn(seekable ? "stroke-foreground/70" : "stroke-foreground/50")}
              />
            ) : null}
          </svg>

          {cursorX !== null && cursorSpeedY !== null ? (
            <span
              aria-hidden
              className="bg-card pointer-events-none absolute size-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${(cursorX / PLOT_W) * 100}%`, top: `${(cursorSpeedY / PLOT_H) * 100}%` }}
            >
              <span className="bg-primary absolute inset-[1.5px] rounded-full" />
            </span>
          ) : null}

          {cursorX !== null && cursorElevationY !== null ? (
            <span
              aria-hidden
              className="bg-card pointer-events-none absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${(cursorX / PLOT_W) * 100}%`, top: `${(cursorElevationY / PLOT_H) * 100}%` }}
            >
              <span className="absolute inset-[1.5px] rounded-full bg-[#8b5e34] dark:bg-[#c99566]" />
            </span>
          ) : null}
        </div>
      </div>

      <div className="text-muted-foreground flex justify-between pl-9 pr-16 text-[10px] tabular-nums">
        {xTicks.map((tick) => (
          <span key={tick}>{formatDuration(tick)}</span>
        ))}
      </div>
    </div>
  );
}
