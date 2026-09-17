"use client";

import { useMemo, useState } from "react";
import { Heart, Mountain, Zap } from "lucide-react";

import { useWorkout } from "@/components/workout-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { paceFromSpeed } from "@/lib/ble/ftms/treadmill-data";
import { KM_PER_MILE } from "@/lib/ble/ftms/speed-units";
import { formatDuration, formatHeartRate, METRES_PER_FOOT } from "@/lib/format";
import { CHART_CAPTURE_ID } from "@/lib/screenshot/capture";
import { cn } from "@/lib/utils";
import type { WorkoutSample } from "@/lib/workout/session";

/**
 * Rolling chart of pace, elevation and heart rate, placed directly under the
 * Track card.
 *
 * The window length is picked from WINDOW_OPTIONS (30 / 60 / 120 minutes),
 * via the buttons in the card — same radiogroup-of-pills pattern as the lap
 * length selector on the Track card. Early in a workout the window is pinned
 * to [0, length] and the line simply fills in from the left; once the
 * workout runs past that length, the window instead slides to always show
 * the most recent stretch — which is what reads as the chart "starting to
 * scroll". Both phases share the same math: the window is
 * `[end - length, end]` where `end = max(length, latest sample's elapsed
 * time)`.
 *
 * Three small-multiple plots rather than one shared axis: pace (min/mi),
 * elevation (ft) and heart rate (bpm) live on unrelated scales, and
 * overlaying them on one axis — or worse, two — would invent a correlation
 * that isn't there. Each plot keeps its own y-domain; only the x-axis
 * (elapsed time) is shared, via one pointer-tracked crosshair.
 */

interface WindowOption {
  minutes: number;
  label: string;
}

const WINDOW_OPTIONS: WindowOption[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "60 min" },
  { minutes: 120, label: "120 min" },
];

const DEFAULT_WINDOW_MINUTES = 30;

/** Spacing between x-axis tick labels, scaled to the selected window so a
 *  120-minute window doesn't cram 24 five-minute labels into one row — each
 *  option lands on 6 evenly-spaced ticks. */
function tickIntervalSeconds(windowMinutes: number): number {
  if (windowMinutes <= 30) return 5 * 60;
  if (windowMinutes <= 60) return 10 * 60;
  return 20 * 60;
}

/** Width, in CSS px, reserved on the left of every plot for its y-axis tick
 *  labels — a plain constant (not a Tailwind class) so the pointer-tracking
 *  math below can subtract it precisely. Matches the `pl-9` / `w-9` used on
 *  the elements themselves. */
const AXIS_GUTTER_PX = 36;

/** Coordinate system each plot's <svg viewBox> uses. Arbitrary — the SVG
 *  scales it to fit the container — chosen only so the numbers in the path
 *  data below stay readable. */
const PLOT_W = 300;
const PLOT_H = 64;

/**
 * Ceiling for the pace plot's y-domain, in minutes per mile. Every workout
 * starts at a fixed 0.5 mph (see STARTING_SPEED_KPH in workout-provider.tsx)
 * before the runner ramps up, which is a 120 min/mi pace — left unclamped,
 * that one moment at the start of every workout would blow the auto-scaled
 * domain out to triple digits and squash the real pace variation into a
 * sliver at the bottom of the chart. Pace values are capped at this ceiling
 * (see the "pace" SeriesDef below) rather than treated as a gap, so a slow
 * start still reads as "pinned at the top", not as missing data.
 */
export const PACE_MAX_MIN_PER_MILE = 20;

interface ChartPoint {
  elapsedS: number;
  value: number | undefined;
}

interface SeriesDef {
  key: string;
  label: string;
  unit: string;
  icon: typeof Heart;
  stroke: string;
  fill: string;
  dot: string;
  text: string;
  value: (sample: WorkoutSample) => number | undefined;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  /** Flips the y-axis so the smaller end of the domain plots at the top.
   *  Pace is the one metric here where a bigger number is a worse result —
   *  a slower mile — so without this a runner speeding up would see the
   *  pace line dip *down* while the elevation/heart-rate lines above and
   *  below it climb, which reads backwards. Inverted, "up" means "faster"
   *  on every one of the three mini-charts. */
  invert?: boolean;
}

const SERIES: SeriesDef[] = [
  {
    key: "pace",
    label: "Pace",
    unit: "/mi",
    icon: Zap,
    // Literal hex, not Tailwind's sky-500/400 palette classes: those compile
    // to oklch(), and html2canvas-pro (see capture.ts) renders this app's
    // oklch colors wrong in the downloaded screenshot. These are the exact
    // sRGB values the browser already resolves sky-500/sky-400 to, so this
    // is a no-op on screen — see the comment block in globals.css.
    //
    // The fill below is a literal rgba(), not `fill-[#00a6f4]/10`: Tailwind
    // v4 compiles a hex-plus-opacity-modifier arbitrary value to oklab() (to
    // do the alpha mixing), which reintroduces the exact same html2canvas-pro
    // color bug this whole literal-hex approach exists to avoid. A pre-built
    // rgba() in brackets has nothing left for Tailwind to convert.
    stroke: "stroke-[#00a6f4] dark:stroke-[#00bcff]",
    fill: "fill-[rgba(0,166,244,0.1)]",
    dot: "bg-[#00a6f4] dark:bg-[#00bcff]",
    text: "text-[#00a6f4] dark:text-[#00bcff]",
    value: (sample) => {
      const paceMinPerKm = paceFromSpeed(sample.speedKph);
      if (paceMinPerKm === undefined) return undefined;
      return Math.min(paceMinPerKm * KM_PER_MILE, PACE_MAX_MIN_PER_MILE);
    },
    formatValue: formatMinSec,
    formatTick: formatMinSec,
    invert: true,
  },
  {
    key: "elevation",
    label: "Elevation",
    unit: "ft",
    icon: Mountain,
    // See the pace series above: literal hex to dodge html2canvas-pro's
    // oklch-conversion bug, equivalent to amber-500/400/600. Fill is a
    // literal rgba() for the same reason noted there.
    stroke: "stroke-[#fe9a00] dark:stroke-[#ffb900]",
    fill: "fill-[rgba(254,154,0,0.1)]",
    dot: "bg-[#fe9a00] dark:bg-[#ffb900]",
    text: "text-[#e17100] dark:text-[#ffb900]",
    value: (sample) => (sample.elevationM ?? 0) / METRES_PER_FOOT,
    formatValue: (value) => `${value > 0 ? "+" : ""}${Math.round(value)}`,
    formatTick: (value) => `${Math.round(value)}`,
  },
  {
    key: "heartRate",
    label: "Heart rate",
    unit: "bpm",
    icon: Heart,
    // See the pace series above: literal hex to dodge html2canvas-pro's
    // oklch-conversion bug, equivalent to rose-500/400. Fill is a literal
    // rgba() for the same reason noted there.
    stroke: "stroke-[#ff2056] dark:stroke-[#ff637e]",
    fill: "fill-[rgba(255,32,86,0.1)]",
    dot: "bg-[#ff2056] dark:bg-[#ff637e]",
    text: "text-[#ff2056] dark:text-[#ff637e]",
    value: (sample) => sample.heartRateBpm,
    formatValue: (value) => formatHeartRate(value),
    formatTick: (value) => `${Math.round(value)}`,
  },
];

/** `M:SS`, signed. This chart's own y-domains are already sane (a handful of
 *  minutes per mile), so unlike `formatPace` in lib/format.ts this needs
 *  neither its unit conversion (values here are already minutes per mile)
 *  nor its "faster than this is implausible" cap. Exported so share-card.tsx
 *  can format its own pace axis ticks the same way. */
export function formatMinSec(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "—";
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  const minutes = Math.floor(abs);
  const seconds = Math.round((abs - minutes) * 60);
  return seconds === 60
    ? `${sign}${minutes + 1}:00`
    : `${sign}${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Rounds a raw tick step up to a "nice" 1/2/5 x 10^n value. */
function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

/**
 * A padded, round-numbered y-domain and the gridline values inside it.
 * `ticks` always starts exactly at the returned `min` and ends exactly at
 * `max`, evenly spaced — which is what lets the y-axis label column below
 * use a plain CSS `justify-between` and land on the same pixels as the
 * SVG's own gridlines, with no shared layout code between the two.
 *
 * Exported so share-card.tsx's combined chart can give pace and heart rate
 * their own real, rounded axis domains too, rather than reimplementing this.
 */
export function niceDomain(min: number, max: number, tickCount = 3): { min: number; max: number; ticks: number[] } {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    const center = Number.isFinite(lo) ? lo : 0;
    lo = center - 1;
    hi = center + 1;
  }
  const step = niceStep((hi - lo) / Math.max(1, tickCount - 1));
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) ticks.push(value);
  return { min: niceMin, max: niceMax, ticks };
}

/**
 * Maps a value in [domainMin, domainMax] to a y coordinate in [0, PLOT_H].
 * Normally the larger end of the domain plots at the top (y=0), same as any
 * ordinary chart; `invert` flips that, so the *smaller* end plots at the
 * top — see the `invert` field on SeriesDef for why pace uses this.
 */
function valueToY(value: number, domainMin: number, domainMax: number, invert: boolean): number {
  const span = Math.max(1e-6, domainMax - domainMin);
  const t = (value - domainMin) / span;
  return invert ? t * PLOT_H : PLOT_H - t * PLOT_H;
}

/**
 * Builds an SVG line + area path from a (possibly gappy) series of points,
 * starting a new sub-path across a gap rather than interpolating over it —
 * a belt stopped for ten seconds should read as a gap in the pace line, not
 * a straight segment pretending to know what happened in between.
 */
function buildPaths(
  points: ChartPoint[],
  windowStart: number,
  windowSeconds: number,
  domainMin: number,
  domainMax: number,
  invert: boolean,
): { line: string; area: string } {
  const xyOf = (point: ChartPoint): [number, number] => {
    const x = ((point.elapsedS - windowStart) / windowSeconds) * PLOT_W;
    const y = valueToY(point.value as number, domainMin, domainMax, invert);
    return [x, y];
  };

  let line = "";
  let area = "";
  let runStartX: number | null = null;
  let lastX: number | null = null;

  const closeRun = () => {
    if (runStartX !== null && lastX !== null) {
      area += ` L ${lastX.toFixed(2)} ${PLOT_H} L ${runStartX.toFixed(2)} ${PLOT_H} Z`;
    }
    runStartX = null;
    lastX = null;
  };

  for (const point of points) {
    if (point.value === undefined) {
      closeRun();
      continue;
    }
    const [x, y] = xyOf(point);
    if (runStartX === null) {
      line += ` M ${x.toFixed(2)} ${y.toFixed(2)}`;
      area += ` M ${x.toFixed(2)} ${PLOT_H} L ${x.toFixed(2)} ${y.toFixed(2)}`;
      runStartX = x;
    } else {
      line += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      area += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    lastX = x;
  }
  closeRun();

  return { line: line.trim(), area: area.trim() };
}

export function WorkoutChart() {
  const { workout } = useWorkout();
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  const [windowMinutes, setWindowMinutes] = useState(DEFAULT_WINDOW_MINUTES);
  const windowSeconds = windowMinutes * 60;

  const { windowStart, windowEnd, points } = useMemo(() => {
    const samples = workout.samples;
    const latestElapsedS = samples.length > 0 ? samples[samples.length - 1].elapsedS : 0;
    const windowEnd = Math.max(windowSeconds, latestElapsedS);
    const windowStart = windowEnd - windowSeconds;
    return {
      windowStart,
      windowEnd,
      points: samples.filter((sample) => sample.elapsedS >= windowStart),
    };
  }, [workout.samples, windowSeconds]);

  const hasData = points.length > 0;

  const hoveredSample = useMemo(() => {
    if (hoverFrac === null || points.length === 0) return null;
    const targetElapsedS = windowStart + hoverFrac * windowSeconds;
    let closest = points[0];
    let closestDelta = Math.abs(points[0].elapsedS - targetElapsedS);
    for (const sample of points) {
      const delta = Math.abs(sample.elapsedS - targetElapsedS);
      if (delta < closestDelta) {
        closest = sample;
        closestDelta = delta;
      }
    }
    return closest;
  }, [hoverFrac, points, windowStart, windowSeconds]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const usableWidth = rect.width - AXIS_GUTTER_PX;
    if (usableWidth <= 0) return;
    const frac = (event.clientX - rect.left - AXIS_GUTTER_PX) / usableWidth;
    setHoverFrac(Math.min(1, Math.max(0, frac)));
  };
  const handlePointerLeave = () => setHoverFrac(null);

  // X-axis ticks, evenly spaced across the window (see tickIntervalSeconds).
  // The window is always exactly windowSeconds wide (see the memo above), so
  // these land evenly spaced across the row every time — a plain
  // `justify-between` beneath the plots lines them up without needing to
  // compute pixel offsets.
  const xTicks = useMemo(() => {
    const interval = tickIntervalSeconds(windowMinutes);
    const ticks: number[] = [];
    const firstTick = Math.ceil(windowStart / interval) * interval;
    for (let t = firstTick; t <= windowEnd + 1; t += interval) ticks.push(t);
    return ticks;
  }, [windowStart, windowEnd, windowMinutes]);

  return (
    <Card id={CHART_CAPTURE_ID}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Pace, elevation &amp; heart rate</CardTitle>
          <span className="text-muted-foreground text-xs font-medium tabular-nums">
            {hoveredSample
              ? `at ${formatDuration(hoveredSample.elapsedS)}`
              : hasData
                ? `last ${formatDuration(windowEnd - windowStart)}`
                : null}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Chart time window">
            {WINDOW_OPTIONS.map((option) => {
              const selected = option.minutes === windowMinutes;
              return (
                <button
                  key={option.minutes}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setWindowMinutes(option.minutes);
                    setHoverFrac(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {hasData ? (
            <div className="space-y-3" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
              {SERIES.map((series) => (
                <WorkoutChartRow
                  key={series.key}
                  series={series}
                  points={points}
                  windowStart={windowStart}
                  windowSeconds={windowSeconds}
                  hoveredSample={hoveredSample}
                />
              ))}

              <div className="text-muted-foreground flex justify-between pl-9 text-[10px] tabular-nums">
                {xTicks.map((tick) => (
                  <span key={tick}>{formatDuration(tick)}</span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Your pace, elevation and heart rate will chart here once the workout starts.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WorkoutChartRow({
  series,
  points,
  windowStart,
  windowSeconds,
  hoveredSample,
}: {
  series: SeriesDef;
  points: WorkoutSample[];
  windowStart: number;
  windowSeconds: number;
  hoveredSample: WorkoutSample | null;
}) {
  const chartPoints: ChartPoint[] = useMemo(
    () => points.map((sample) => ({ elapsedS: sample.elapsedS, value: series.value(sample) })),
    [points, series],
  );

  const definedValues = chartPoints
    .map((point) => point.value)
    .filter((value): value is number => value !== undefined);
  const hasSeriesData = definedValues.length > 0;
  const domain = hasSeriesData
    ? niceDomain(Math.min(...definedValues), Math.max(...definedValues))
    : { min: 0, max: 1, ticks: [] as number[] };

  const invert = series.invert ?? false;

  const { line, area } = useMemo(
    () => buildPaths(chartPoints, windowStart, windowSeconds, domain.min, domain.max, invert),
    [chartPoints, windowStart, windowSeconds, domain.min, domain.max, invert],
  );

  const activeSample = hoveredSample ?? points[points.length - 1];
  const displayValue = activeSample ? series.value(activeSample) : undefined;
  const markerX = activeSample ? ((activeSample.elapsedS - windowStart) / windowSeconds) * PLOT_W : null;
  const markerY =
    markerX !== null && displayValue !== undefined
      ? valueToY(displayValue, domain.min, domain.max, invert)
      : null;

  const Icon = series.icon;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <Icon className={`size-3.5 ${series.text}`} />
          {series.label}
        </span>
        <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
          {displayValue !== undefined ? series.formatValue(displayValue) : "—"}
          <span className="text-muted-foreground ml-1 text-xs font-normal">{series.unit}</span>
        </span>
      </div>

      {hasSeriesData ? (
        <div className="relative h-16 pl-9">
          <div className="absolute inset-y-0 left-0 flex w-8 flex-col justify-between py-0.5 text-right">
            {/* Ticks ascend [min...max]. Normally the top of the plot is
             *  the domain's max, so the label column reads top-to-bottom
             *  as [max...min] — reversed. When this series is inverted
             *  (pace: min at top), the labels stay in ascending order to
             *  match. */}
            {(invert ? domain.ticks : [...domain.ticks].reverse()).map((tick) => (
              <span key={tick} className="text-muted-foreground text-[9px] leading-none tabular-nums">
                {series.formatTick(tick)}
              </span>
            ))}
          </div>

          {/* A plain relative box the same size as the plot, so the marker
           *  dots below can be positioned in ordinary (uniformly-scaled)
           *  CSS percentages instead of living inside the SVG's viewBox —
           *  see the comment on the dots themselves for why. */}
          <div className="relative h-full w-full">
            <svg
              viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              role="img"
              aria-label={`${series.label} over the last ${Math.round(windowSeconds / 60)} minutes, currently ${
                displayValue !== undefined ? series.formatValue(displayValue) : "no reading"
              }`}
            >
              {domain.ticks.map((tick) => {
                const y = valueToY(tick, domain.min, domain.max, invert);
                return (
                  <line
                    key={tick}
                    x1={0}
                    y1={y}
                    x2={PLOT_W}
                    y2={y}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1}
                    className="stroke-muted-foreground/15"
                  />
                );
              })}

              <path d={area} stroke="none" className={series.fill} />
              <path
                d={line}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={series.stroke}
              />

              {hoveredSample ? (
                <line
                  x1={(markerX ?? 0)}
                  y1={0}
                  x2={(markerX ?? 0)}
                  y2={PLOT_H}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={1}
                  className="stroke-foreground/25"
                />
              ) : null}
            </svg>

            {/*
             * The end/hover dot is plain HTML, not an SVG <circle>, on
             * purpose: the <svg> above stretches x and y independently
             * (viewBox 300x64 mapped onto a wide, short box, via
             * `preserveAspectRatio="none"`) so the line reaches every edge
             * — but that same non-uniform scale turns a circle into an
             * oval. Positioning a normal, unstretched div by percentage
             * over this same box keeps it round regardless of how wide the
             * card is.
             */}
            {markerX !== null && markerY !== null ? (
              <span
                aria-hidden
                className="bg-card pointer-events-none absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${(markerX / PLOT_W) * 100}%`, top: `${(markerY / PLOT_H) * 100}%` }}
              >
                <span
                  className={`absolute inset-[1.5px] rounded-full ${series.dot}`}
                />
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground py-4 text-center text-xs">
          No {series.label.toLowerCase()} data yet
        </p>
      )}
    </div>
  );
}
