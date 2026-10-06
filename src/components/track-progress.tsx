"use client";

import { useMemo, useRef, useState } from "react";

import { useWorkout } from "@/components/workout-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TRACK_CAPTURE_ID } from "@/lib/screenshot/capture";
import { paceFromSpeed } from "@/lib/ble/ftms/treadmill-data";
import {
  formatElevation,
  formatHeartRate,
  formatPace,
  paceUnitLabel,
  METRES_PER_MILE,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkoutSample } from "@/lib/workout/session";

/**
 * Virtual track: the runner's dot laps this loop once per lap length of
 * accumulated workout distance, the way a treadmill console's own track
 * graphic works. The runner picks the lap length from the buttons above the
 * track (see LAP_LENGTH_OPTIONS); .5 mi is the default.
 */
interface LapLengthOption {
  miles: number;
  label: string;
}

const LAP_LENGTH_OPTIONS: LapLengthOption[] = [
  { miles: 0.25, label: ".25 mi" },
  { miles: 0.5, label: ".5 mi" },
  { miles: 1, label: "1 mi" },
];

const DEFAULT_LAP_LENGTH_MILES = 0.5;

// Geometry of the stadium (rounded-rectangle) track, in SVG user-space units.
// Proportioned like a standard 400m running track (roughly 1.9:1 overall
// width to height, with turns that are a large fraction of the shape rather
// than a stretched-out pill) so it reads as a track, not a capsule.
const RADIUS = 90;
const STRAIGHT = 170;
const STROKE_WIDTH = 16;
const DOT_RADIUS = 11;
const PAD = 26;

const TRACK_TOP = PAD;
const TRACK_BOTTOM = PAD + RADIUS * 2;
const CENTER_Y = PAD + RADIUS;
const CENTER_X_LEFT = PAD + RADIUS;
const CENTER_X_RIGHT = PAD + RADIUS + STRAIGHT;
/** Exported alongside TRACK_PATH so the share card (share-card.tsx) can draw
 *  the same stadium outline as a decorative motif without re-deriving the
 *  geometry — one shape, two renderers. */
export const VIEW_WIDTH = PAD * 2 + RADIUS * 2 + STRAIGHT;
export const VIEW_HEIGHT = PAD * 2 + RADIUS * 2;
const ARC_LENGTH = Math.PI * RADIUS;
const PERIMETER = STRAIGHT * 2 + ARC_LENGTH * 2;

// Both turns sweep the same way (flag 0): starting at the bottom straight and
// walking bottom -> right turn -> top straight -> left turn -> back to start,
// a sweep of 0 on *both* arcs is what keeps the outline bulging outward on
// each side instead of one turn folding back on itself.
export const TRACK_PATH = [
  `M ${CENTER_X_LEFT} ${TRACK_BOTTOM}`,
  `L ${CENTER_X_RIGHT} ${TRACK_BOTTOM}`,
  `A ${RADIUS} ${RADIUS} 0 0 0 ${CENTER_X_RIGHT} ${TRACK_TOP}`,
  `L ${CENTER_X_LEFT} ${TRACK_TOP}`,
  `A ${RADIUS} ${RADIUS} 0 0 0 ${CENTER_X_LEFT} ${TRACK_BOTTOM}`,
  "Z",
].join(" ");

/**
 * Point on the loop for a lap fraction in [0, 1). Walks the same route as
 * TRACK_PATH, in the same order: bottom straight, right turn, top straight,
 * left turn, so the dot always sits exactly on the drawn outline.
 */
function pointOnTrack(fraction: number): { x: number; y: number } {
  const wrapped = ((fraction % 1) + 1) % 1;
  const s = wrapped * PERIMETER;

  if (s <= STRAIGHT) {
    return { x: CENTER_X_LEFT + s, y: TRACK_BOTTOM };
  }
  if (s <= STRAIGHT + ARC_LENGTH) {
    const angle = Math.PI / 2 - (s - STRAIGHT) / RADIUS;
    return {
      x: CENTER_X_RIGHT + RADIUS * Math.cos(angle),
      y: CENTER_Y + RADIUS * Math.sin(angle),
    };
  }
  if (s <= STRAIGHT * 2 + ARC_LENGTH) {
    return { x: CENTER_X_RIGHT - (s - STRAIGHT - ARC_LENGTH), y: TRACK_TOP };
  }
  const angle = -Math.PI / 2 - (s - STRAIGHT * 2 - ARC_LENGTH) / RADIUS;
  return {
    x: CENTER_X_LEFT + RADIUS * Math.cos(angle),
    y: CENTER_Y + RADIUS * Math.sin(angle),
  };
}

interface LapSplit {
  lap: number;
  avgSpeedKph: number;
  elevationGainM: number;
  avgHeartRateBpm?: number;
}

/**
 * Splits the recorded samples into completed `lapMetres`-long segments and
 * summarizes each one's pace, heart rate and climb.
 *
 * Elevation gain per lap is re-derived from incline x distance covered
 * between samples, the same fallback formula `WorkoutRecorder.tick` itself
 * falls back to when a treadmill has no dedicated elevation-gain
 * characteristic (see session.ts): a `WorkoutSample` only carries a
 * continuous altitude trace, not a running gain total, so this is
 * recomputed here rather than sliced out of the snapshot. For the (rare)
 * treadmill that does report a native gain characteristic, this is an
 * approximation, accurate to within one sample's worth of distance at each
 * lap boundary since the recorder samples at 1 Hz.
 */
function computeLapSplits(samples: WorkoutSample[], lapMetres: number): LapSplit[] {
  const splits: LapSplit[] = [];
  if (lapMetres <= 0) return splits;

  let lapStartDistanceM = 0;
  let lapStartElapsedS = 0;
  let lapElevationGainM = 0;
  let previousDistanceM = 0;
  let heartRateSum = 0;
  let heartRateCount = 0;

  for (const sample of samples) {
    const deltaM = Math.max(0, sample.distanceM - previousDistanceM);
    previousDistanceM = sample.distanceM;
    lapElevationGainM += (Math.max(0, sample.inclinePercent ?? 0) / 100) * deltaM;
    if (sample.heartRateBpm !== undefined) {
      heartRateSum += sample.heartRateBpm;
      heartRateCount += 1;
    }

    while (sample.distanceM - lapStartDistanceM >= lapMetres) {
      const lapDurationS = sample.elapsedS - lapStartElapsedS;
      splits.push({
        lap: splits.length + 1,
        avgSpeedKph: lapDurationS > 0 ? (lapMetres / lapDurationS) * 3.6 : 0,
        elevationGainM: lapElevationGainM,
        avgHeartRateBpm: heartRateCount > 0 ? heartRateSum / heartRateCount : undefined,
      });
      lapStartDistanceM += lapMetres;
      lapStartElapsedS = sample.elapsedS;
      lapElevationGainM = 0;
      heartRateSum = 0;
      heartRateCount = 0;
    }
  }

  return splits;
}

/** This app always displays in US customary units — see live-dashboard.tsx. */
const DISPLAY_UNIT = "mph";

/** Rows visible in the lap-split list before it scrolls (see the fixed row
 *  height baked into the row's own className below). */
const VISIBLE_SPLIT_ROWS = 20;

/**
 * Shared column widths for the split header and every split row, so they
 * line up. Fixed widths sized to the content (rather than `1fr` columns
 * stretching to fill the row) are what keep the list itself narrow — the
 * track gets the space that frees up, see the flex layout below.
 */
const SPLIT_ROW_GRID = "grid-cols-[1.5rem_4.25rem_3.25rem_3.5rem]";

/**
 * How long the dot's slide to a new position takes. The recorder only folds
 * a new sample in once a second (see `SAMPLE_INTERVAL_MS` in
 * workout-provider.tsx), which without this made the dot hop to a new spot
 * once a second rather than appear to run continuously. Matching the
 * transition to that interval turns each hop into a steady glide that
 * finishes right as the next sample arrives, instead of animating faster
 * than new positions show up (which would just look like it pauses) or
 * slower (which would look like it's still catching up when the next hop
 * starts).
 */
const POSITION_TRANSITION_MS = 1_000;

export function TrackProgress() {
  const { workout } = useWorkout();
  const [lapLengthMiles, setLapLengthMiles] = useState(DEFAULT_LAP_LENGTH_MILES);
  const selectedLapLength =
    LAP_LENGTH_OPTIONS.find((option) => option.miles === lapLengthMiles) ?? LAP_LENGTH_OPTIONS[1];

  const { progress, lap, lapMiles, splits } = useMemo(() => {
    const lapMetres = lapLengthMiles * METRES_PER_MILE;
    const distanceM = Number.isFinite(workout.distanceM) ? Math.max(0, workout.distanceM) : 0;
    const distanceIntoLapM = distanceM % lapMetres;
    return {
      progress: distanceIntoLapM / lapMetres,
      lap: Math.floor(distanceM / lapMetres) + 1,
      lapMiles: distanceIntoLapM / METRES_PER_MILE,
      splits: computeLapSplits(workout.samples, lapMetres),
    };
  }, [workout.distanceM, workout.samples, lapLengthMiles]);

  // A new lap resets progress from ~1 back to 0, which would otherwise glide
  // the dot backwards across the whole track instead of hopping straight to
  // the start line. Comparing against the previous render's progress catches
  // that one case (a real per-tick advance is at most a couple of percent,
  // even at this track's fastest supported speed) so just that transition
  // can be skipped; every other update still glides normally. Switching lap
  // length is the other case — the same distance lands at a different point
  // on the loop under a different lap length, and that reshuffle should snap
  // too rather than glide across the track as if it were a run of distance.
  // Updating the refs during render like this is safe here — they only ever
  // feed this same comparison next render, never anything rendered this pass.
  const previousProgressRef = useRef(progress);
  const previousLapLengthRef = useRef(lapLengthMiles);
  const lapWrapped =
    progress < previousProgressRef.current - 0.5 || lapLengthMiles !== previousLapLengthRef.current;
  previousProgressRef.current = progress;
  previousLapLengthRef.current = lapLengthMiles;

  const dot = pointOnTrack(progress);
  const trailLength = progress * PERIMETER;
  const transition = lapWrapped ? "none" : `all ${POSITION_TRANSITION_MS}ms linear`;

  const lapLengthPicker = (className: string) => (
    <div
      className={cn("items-center gap-1.5", className)}
      role="radiogroup"
      aria-label="Track lap length"
    >
      {LAP_LENGTH_OPTIONS.map((option) => {
        const selected = option.miles === lapLengthMiles;
        return (
          <button
            key={option.miles}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setLapLengthMiles(option.miles)}
            className={cn(
              "rounded-full px-3.5 py-2.5 text-xs font-semibold transition-colors",
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
  );

  return (
    <Card id={TRACK_CAPTURE_ID} className="gap-3">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Track</CardTitle>
          <span className="text-muted-foreground text-xs font-medium">
            Lap {lap} · {selectedLapLength.label}
          </span>
        </div>
      </CardHeader>

      {/* On a phone the splits stay to the right of the track (rather than
          stacking under it), and the track shrinks to whatever width is
          left. The lap-length picker moves to its own full-width row above
          on phones, since the narrow track column has no room for it. */}
      <CardContent className="flex flex-col gap-3 pt-1">
        {lapLengthPicker("flex justify-center sm:hidden")}

        <div className="flex flex-row items-start gap-3 sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
            {lapLengthPicker("hidden sm:flex")}

            <svg
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              className="w-full"
              role="img"
              aria-label={`Lap ${lap} of the ${selectedLapLength.label} track, ${Math.round(progress * 100)}% complete`}
            >
              <path
                d={TRACK_PATH}
                fill="none"
                strokeWidth={STROKE_WIDTH}
                className="stroke-muted-foreground/20"
              />
              <path
                d={TRACK_PATH}
                fill="none"
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                className="stroke-primary"
                // A constant dasharray (dash = gap = the full loop) with an
                // animated dashoffset reveals the first `trailLength` of the
                // path. This is driven off dashoffset rather than a varying
                // dasharray specifically so the glide above has one plain
                // number to transition — CSS interpolates a single value
                // reliably; animating a two-part "dash gap" string is not
                // guaranteed to interpolate smoothly the same way.
                strokeDasharray={PERIMETER}
                strokeDashoffset={PERIMETER - trailLength}
                style={{ transition }}
              />
              {/* Start/finish line, crossing the bottom straight at fraction 0 */}
              <line
                x1={CENTER_X_LEFT}
                y1={TRACK_BOTTOM - STROKE_WIDTH / 2 - 6}
                x2={CENTER_X_LEFT}
                y2={TRACK_BOTTOM + STROKE_WIDTH / 2 + 6}
                strokeWidth={3}
                className="stroke-foreground/30"
              />
              <circle
                cx={dot.x}
                cy={dot.y}
                r={DOT_RADIUS}
                strokeWidth={3}
                className="fill-primary stroke-background"
                style={{ transition }}
              />
            </svg>

            <p className="text-muted-foreground text-center font-mono text-[11px] leading-tight tabular-nums sm:text-xs">
              {lapMiles.toFixed(2)} / {lapLengthMiles.toFixed(2)} mi this lap
            </p>
          </div>

          <Separator orientation="vertical" className="hidden sm:block" />

          <div className="shrink-0">
            <div
              className={`text-muted-foreground grid ${SPLIT_ROW_GRID} gap-x-1.5 px-1 pb-1 text-[10px] sm:gap-x-2 sm:px-1.5 font-semibold uppercase tracking-wide`}
            >
              <span>Lap</span>
              <span>Pace</span>
              <span>Elev</span>
              <span>HR</span>
            </div>

            {splits.length > 0 ? (
              <div
                className="space-y-0.5 overflow-y-auto"
                style={{ maxHeight: `${VISIBLE_SPLIT_ROWS * 24}px` }}
              >
                {splits.map((split) => (
                  <div
                    key={split.lap}
                    className={`odd:bg-muted/40 grid ${SPLIT_ROW_GRID} items-center gap-x-1.5 rounded-md px-1 py-1 sm:gap-x-2 sm:px-1.5`}
                  >
                    <span className="text-muted-foreground text-xs font-medium tabular-nums">
                      {split.lap}
                    </span>
                    <span className="font-mono text-xs font-semibold tabular-nums">
                      {formatPace(paceFromSpeed(split.avgSpeedKph), DISPLAY_UNIT)}
                      <span className="text-muted-foreground ml-1 text-[10px] font-normal">
                        {paceUnitLabel(DISPLAY_UNIT)}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                      +{formatElevation(split.elevationGainM)} ft
                    </span>
                    <span className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                      {formatHeartRate(split.avgHeartRateBpm)}
                      {split.avgHeartRateBpm !== undefined ? (
                        <span className="ml-1 text-[10px] font-normal">bpm</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground max-w-32 px-1 py-2 text-xs sm:max-w-40 sm:px-1.5">
                Lap splits appear here after your first {selectedLapLength.label}.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
