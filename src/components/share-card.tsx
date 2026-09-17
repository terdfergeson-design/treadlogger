"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";

import { TreadmillIcon } from "@/components/icons/treadmill-icon";
import { formatMinSec, niceDomain, PACE_MAX_MIN_PER_MILE } from "@/components/workout-chart";
import { useWorkout } from "@/components/workout-provider";
import { paceFromSpeed } from "@/lib/ble/ftms/treadmill-data";
import { KM_PER_MILE } from "@/lib/ble/ftms/speed-units";
import { SHARE_CARD_CAPTURE_ID } from "@/lib/screenshot/capture";
import {
  formatCadence,
  formatCalories,
  formatElevation,
  formatHeartRate,
  formatPace,
  formatSpeed,
  METRES_PER_FOOT,
  METRES_PER_MILE,
  paceUnitLabel,
  speedUnitLabel,
} from "@/lib/format";
import type { WorkoutSample } from "@/lib/workout/session";

/** This app always displays in US customary units — see live-dashboard.tsx. */
const DISPLAY_UNIT = "mph";

/**
 * Number of equal-length time buckets the full workout is averaged into for
 * the combined chart below — enough to trace a smooth shape without carrying
 * (and rendering a jagged path from) every 1 Hz sample of a long run.
 */
const BUCKET_COUNT = 56;

/** Coordinate system the combined chart's <svg viewBox> uses — arbitrary,
 *  scaled to fit; chosen only so the path math below stays readable. */
const CHART_PLOT_W = 480;
const CHART_PLOT_H = 96;

/** Width, in CSS px, reserved for each side's axis-tick label column. */
const AXIS_LABEL_WIDTH = 34;

/**
 * Compresses every series' plotted range into the bottom this fraction of
 * the chart's height, so even the highest point stops short of the very top
 * edge — a deliberate visual margin (requested directly), not a side effect
 * of the domain math. Applied uniformly in `valueToY` below, after each
 * series' own domain/fraction is computed, so it doesn't change *where*
 * gridline-free axis labels line up relative to their lines — both use the
 * same function.
 */
const TOP_PADDING_FRACTION = 0.84;

/**
 * Colors for the combined chart's three series, picked by request (pace
 * blue, elevation brown, heart rate red — the conventional running-app
 * pairing) rather than the dataviz skill's own categorical order. Ran them
 * through the skill's validator anyway (`node scripts/validate_palette.js
 * "#3987e5,#b57a3d,#e63950" --mode dark --surface "#0a0a09"`): lightness
 * band, chroma floor, contrast and the normal-vision floor all pass, but
 * brown and red fail the colorblind (CVD) separation check hard (ΔE ~2,
 * nowhere near the ≥8 target) — they're both warm, low-to-mid hues sitting
 * close together on the red-green confusion line, and no choice of "a brown"
 * and "a red" clears that gate simultaneously. Mitigated the only way
 * available here: elevation is a *filled area* and heart rate a *thin
 * stroked line* (a shape difference, not just a color one), plus both carry
 * a legend label — real secondary encoding, not a substitute for passing the
 * check, but the honest option when the two colors are the explicit request.
 */
const PACE_COLOR = "#3987e5";
const ELEVATION_COLOR = "#b57a3d";
const HEART_RATE_COLOR = "#e63950";

/**
 * A scan-to-try QR code for the two originally-blank cells in the stats grid
 * (see the `stats` array and `QrCell` below). Embedded as an inline base64
 * `data:` URI, generated once from the attached QR image, rather than a
 * `public/`-folder asset: capture.ts's own header comment documents this
 * capture pipeline's history of "Tainted canvases may not be exported"
 * failures from non-`data:` image sources, and at ~10KB base64 the image is
 * small enough that inlining it here costs nothing worth risking that for.
 */
const QR_CODE_DATA_URI =
  "data:image/png;base64,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";

interface ShareStatDef {
  label: string;
  value: string;
}

/**
 * Distance for the hero figure — the same mi conversion `formatDistance` in
 * lib/format.ts does, but deliberately *not* that function: past 10 miles
 * this drops to one decimal (`10.0` rather than `10.42`), per direct
 * request, rather than the app's usual fixed two decimals everywhere else
 * (workout-summary.tsx's own hero stat, the FIT file, etc. all still want
 * full precision — this truncation is specific to this card's hero figure).
 * The practical effect: "9.99" and "10.0" are both 4 characters, so the
 * hero figure's width stays essentially constant right across the
 * threshold instead of gaining a digit — see `shareTimeValue` below for the
 * matching change to elapsed time, and `heroDistanceSizeClasses` for the
 * (now rarely-needed) size-stepping this was originally paired with.
 */
function shareDistanceValue(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return "0.00";
  const miles = metres / METRES_PER_MILE;
  return miles >= 10 ? miles.toFixed(1) : miles.toFixed(2);
}

/**
 * Elapsed time for the hero row and the chart's end label — the same
 * hour/minute/second math `formatDuration` in lib/format.ts does, but
 * deliberately *not* that function: past one hour this drops seconds
 * entirely (`1:32` rather than `1:32:15`), per direct request, rather than
 * `formatDuration`'s `H:MM:SS`. `formatDuration` itself is untouched and
 * still used everywhere else in the app (workout-summary.tsx's "Moving
 * time", the chart's hover tooltip, heart-rate-zones.tsx) where second-level
 * precision is still wanted. Truncating here means elapsed time essentially
 * never grows past 5 characters at all: `M:SS` tops out at "59:59" (5) below
 * an hour, and `H:MM` for any realistic 1-9 hour run is 4 characters
 * ("1:32") — shorter than the case it replaces, not just steadier.
 */
function shareTimeValue(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Steps the hero distance figure's (and its unit's) size down as the
 * formatted string grows. With `shareDistanceValue` above now truncating to
 * one decimal past 10 miles, the string stays at 4 characters for every
 * realistic distance (up to "99.9") — so in practice this only ever fires
 * for the vanishingly rare 100+ mile treadmill session ("104.0", 5
 * characters). Kept as a last-resort backstop rather than removed: it costs
 * nothing when it doesn't trigger, and it's one less thing to reason about
 * if that edge case ever actually shows up. Tailwind arbitrary-value
 * classes need literal strings to be picked up at build time, so this
 * returns whole class names (all three already appear, verbatim, right
 * here) rather than building one from a computed pixel number.
 */
function heroDistanceSizeClasses(value: string): { figure: string; unit: string } {
  if (value.length <= 4) return { figure: "text-[56px]", unit: "text-[20px]" };
  if (value.length === 5) return { figure: "text-[48px]", unit: "text-[18px]" };
  return { figure: "text-[42px]", unit: "text-[16px]" };
}

/**
 * Steps the Time flank stat's font down for a long value string. With
 * `shareTimeValue` above now dropping seconds past an hour, elapsed time
 * tops out at 5 characters for any realistic run (a 1-9 hour `H:MM` is only
 * 4) — so, like `heroDistanceSizeClasses`, this is now a backstop for an
 * extreme edge case (a 10+ hour continuous session) rather than the
 * everyday mechanism it originally was.
 */
function heroTimeSizeClass(value: string): string {
  return value.length > 5 ? "text-xl" : "text-2xl";
}

/**
 * A purpose-built square graphic for sharing a finished run to Strava,
 * Instagram, etc. — distinct from `saveWorkoutScreenshot`'s stack of the
 * app's own cards (see workout-summary.tsx), which is aimed at keeping a
 * detailed record rather than looking good in a feed.
 *
 * Rendered off-screen at a fixed 540x540 CSS px (captured at a fixed 2x
 * scale — see SHARE_CARD_SCALE in capture.ts — for a crisp 1080x1080 PNG,
 * the standard square size Strava/Instagram expect) rather than shown in the
 * page: it's a distinct design from the live dashboard, not a styled version
 * of it, so there's no "real" on-screen place for it to live.
 *
 * Every color here is a literal rgb()/rgba()/hex in an inline `style`, never
 * a Tailwind color utility class (this file only uses Tailwind for layout,
 * spacing and type — properties that carry no color). That's deliberate:
 * see the extensive root-cause chain in the project's
 * workout-screenshot-feature doc, where both this app's own OKLCH theme
 * colors *and* Tailwind's built-in default palette classes (compiled to
 * oklch()/oklab() at build time) came out wrong through html2canvas-pro,
 * sometimes in ways that took a full investigation to trace. A hand-written
 * color string in a style attribute (or an SVG presentation attribute, for
 * the chart below) never passes through any of that compilation, so none of
 * those bugs can resurface here.
 */
export function ShareCard() {
  const { workout } = useWorkout();

  const chart = useChartSeries(workout.samples, workout.elapsedS);

  if (workout.state !== "finished" || workout.startedAt === undefined) return null;

  // This app always displays distance in miles (see DISPLAY_UNIT above) —
  // formatDistance's own hardcoded "mi" unit, inlined here since this card
  // uses shareDistanceValue instead of formatDistance for the value itself.
  const distanceValue = shareDistanceValue(workout.distanceM);
  const dateLabel = new Date(workout.startedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const hasAvgHeartRate = workout.avgHeartRateBpm !== undefined && workout.avgHeartRateBpm > 0;
  const hasMaxHeartRate = workout.maxHeartRateBpm !== undefined && workout.maxHeartRateBpm > 0;

  // Both computed once here (rather than inline where they're used) because
  // each feeds a size-stepping helper below that needs the formatted string,
  // not the raw number — see heroDistanceSizeClasses and heroTimeSizeClass.
  const timeValue = shareTimeValue(workout.elapsedS);
  const heroSize = heroDistanceSizeClasses(distanceValue);

  // Exact 3x3 layout requested directly (a diagram, not a description): the
  // left column is the pace-family stats top-to-bottom (avg pace, avg
  // speed, max speed), the right column is the "other" stats (calories,
  // avg HR, max HR), and the middle column holds only cadence in the top
  // row. The two cells below cadence were originally left blank (see the
  // project doc's "v4 → v5"); they're now a single "qr" marker occupying
  // both — a scan-to-try QR code — rather than two separate blanks, so
  // `stats` has 8 real entries, not 9. CSS grid auto-placement handles the
  // rest: the `QrCell` below explicitly spans 2 rows via its own `gridRow`
  // style, and every entry *after* it in this array simply continues
  // flowing into whatever cell is next available — the algorithm skips
  // over the cell QrCell's span already occupies on its own, so nothing
  // downstream needs to know the QR code is there.
  const stats: (ShareStatDef | "qr")[] = [
    {
      label: "Avg pace",
      value: `${formatPace(workout.avgPaceMinPerKm, DISPLAY_UNIT)} ${paceUnitLabel(DISPLAY_UNIT)}`,
    },
    { label: "Cadence", value: `${formatCadence(workout.avgCadenceSpm)} spm` },
    { label: "Calories", value: `${formatCalories(workout.energyKcal)} kcal` },
    {
      label: "Avg speed",
      value: `${formatSpeed(workout.avgSpeedKph, DISPLAY_UNIT)} ${speedUnitLabel(DISPLAY_UNIT)}`,
    },
    "qr",
    { label: "Avg HR", value: hasAvgHeartRate ? `${formatHeartRate(workout.avgHeartRateBpm)} bpm` : "—" },
    {
      label: "Max speed",
      value: `${formatSpeed(workout.maxSpeedKph, DISPLAY_UNIT)} ${speedUnitLabel(DISPLAY_UNIT)}`,
    },
    { label: "Max HR", value: hasMaxHeartRate ? `${formatHeartRate(workout.maxHeartRateBpm)} bpm` : "—" },
  ];

  return (
    // Off-screen, not display:none: html2canvas needs the element actually
    // laid out to capture it. Fixed positioning far outside the viewport
    // keeps it out of the visible page and out of normal document flow.
    <div aria-hidden="true" className="pointer-events-none fixed left-[-9999px] top-0">
      <div
        id={SHARE_CARD_CAPTURE_ID}
        className="flex w-[540px] flex-col gap-3 overflow-hidden p-8"
        style={{
          height: 540,
          background: "linear-gradient(160deg, rgb(21, 26, 22) 0%, rgb(8, 10, 9) 70%)",
          color: "rgb(255, 255, 255)",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className="flex size-8 items-center justify-center rounded-[10px]"
              style={{ background: "rgb(74, 219, 114)" }}
            >
              <TreadmillIcon className="size-[18px]" style={{ color: "rgb(0, 26, 8)" }} />
            </span>
            <span
              className="text-[13px] font-bold tracking-[0.14em]"
              style={{ color: "rgba(255, 255, 255, 0.55)" }}
            >
              TREADLOGGER
            </span>
          </div>
          <span className="text-[13px] font-semibold" style={{ color: "rgba(255, 255, 255, 0.55)" }}>
            {dateLabel}
          </span>
        </div>

        {/* Hero row: the distance stays the visual centerpiece, flanked by
         *  time (left) and elevation gain (right) — smaller, secondary
         *  numbers rather than a fourth hero, matching the app's own
         *  "biggest number wins" hierarchy from workout-summary.tsx. */}
        <div className="flex items-center justify-center gap-6">
          <HeroFlankStat label="Time" value={timeValue} sizeClass={heroTimeSizeClass(timeValue)} />

          <div className="flex flex-col items-center">
            <span
              className="mb-1 text-[13px] font-bold tracking-[0.16em]"
              style={{ color: "rgb(120, 235, 154)" }}
            >
              TREADMILL RUN
            </span>
            {/* Hero figure: proportional (not tabular) numerals — tabular-nums
             *  is for aligned columns, not a large standalone display value.
             *  Value truncates to one decimal past 10 miles (see
             *  shareDistanceValue) and the size-stepping in
             *  heroDistanceSizeClasses is a backstop beyond that. */}
            <div className="flex items-baseline gap-2">
              <span className={`${heroSize.figure} leading-none font-extrabold`}>{distanceValue}</span>
              <span className={`${heroSize.unit} font-semibold`} style={{ color: "rgba(255, 255, 255, 0.6)" }}>
                mi
              </span>
            </div>
          </div>

          <HeroFlankStat label="Elev gain" value={`${formatElevation(workout.elevationGainM)} ft`} />
        </div>

        {chart ? <CombinedChart chart={chart} totalElapsedS={workout.elapsedS} /> : null}

        <div
          className="grid flex-1 grid-cols-3 content-center gap-x-2 gap-y-2 pt-2"
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.12)" }}
        >
          {stats.map((stat) =>
            stat === "qr" ? <QrCell key="qr" /> : <ShareStat key={stat.label} label={stat.label} value={stat.value} />,
          )}
        </div>
      </div>
    </div>
  );
}

function ShareStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-mono text-base font-bold tabular-nums">{value}</span>
      <span
        className="text-[9px] font-semibold tracking-[0.08em] uppercase"
        style={{ color: "rgba(255, 255, 255, 0.5)" }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Fills the two originally-blank cells below "Cadence" (see the `stats`
 * array's comment above) with a scan-to-try QR code and a short caption,
 * rather than leaving them empty. Spans both grid rows itself, via
 * `gridRow: "span 2"` on its own wrapper — see that same comment for why
 * nothing else in the grid needs to know it's there.
 *
 * Sized to fit the roughly 70px two-row-plus-gap budget the grid actually
 * has here (both `ShareStat` rows' natural height, plus the row gap between
 * them, now folded into this one spanning cell) without growing the card
 * past its fixed 540px height: a 48px QR image, unlike every other color on
 * this card, needs no rgb()-string workaround — it's a plain <img>, not
 * something html2canvas-pro repaints — plus a small two-line caption below
 * it. Like the rest of this card's rendered-but-unseen state, not yet
 * independently verified against a live redeploy; see the project doc.
 */
function QrCell() {
  return (
    <div className="flex flex-col items-center justify-center gap-1" style={{ gridRow: "span 2" }}>
      <img
        src={QR_CODE_DATA_URI}
        alt="QR code to try TreadLogger"
        width={48}
        height={48}
        style={{ display: "block", borderRadius: 4 }}
      />
      {/* Caption color is the exact hex requested — the same green already
       *  used for the logo badge above (rgb(74, 219, 114) = #4ADB72) — and
       *  deliberately not `uppercase` like the stat labels: the requested
       *  text is mixed-case and stays that way. */}
      <span
        className="text-center text-[7px] leading-tight font-bold tracking-[0.02em]"
        style={{ color: "#4ADB72" }}
      >
        Scan Here to Try Treadlogger
      </span>
    </div>
  );
}

/** A secondary number flanking the hero distance (time on the left, elevation
 *  gain on the right) — bigger than the bottom stats grid's entries (this
 *  sits at hero height, not grid height) but plainly smaller than the hero
 *  number itself, so distance stays the one figure the eye lands on first.
 *  `sizeClass` defaults to the original text-2xl; the Time instance passes a
 *  stepped-down size once its string gets long — see heroTimeSizeClass. */
function HeroFlankStat({ label, value, sizeClass = "text-2xl" }: { label: string; value: string; sizeClass?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`font-mono ${sizeClass} font-bold tabular-nums`}>{value}</span>
      <span
        className="text-[10px] font-semibold tracking-[0.08em] uppercase"
        style={{ color: "rgba(255, 255, 255, 0.5)" }}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combined pace / elevation / heart-rate chart
//
// Three small-multiple plots (workout-chart.tsx's approach) don't fit a
// square share card, and this graphic isn't the place for another rolling
// window selector — it's meant to show the *shape* of the whole run at a
// glance. An earlier version min-max normalized all three series onto one
// shared 0-100% axis specifically to avoid a dual-axis chart (the dataviz
// skill's #1 anti-pattern: two y-scales inventing a correlation that isn't
// there). That's been deliberately reversed here per direct request: pace
// (left) and heart rate (right) now each get a real, labeled axis with
// actual units — the standard convention in running apps, where readers
// expect to read an actual pace and an actual heart rate off the chart, not
// just its shape. Elevation keeps its own unlabeled raw min/max range (a
// third axis would be one too many to draw) — it's the terrain silhouette
// behind the two real metrics, not something a reader needs to read a
// number off of.
// ---------------------------------------------------------------------------

interface ChartSeries {
  /** Raw bucketed values (gap-filled), one per bucket, left-to-right in
   *  time — no longer normalized: pace and heart rate need their real units
   *  to build real axis domains (see `niceDomain` below). Pace is minutes
   *  per mile (capped, see PACE_MAX_MIN_PER_MILE), elevation is feet, heart
   *  rate is bpm. */
  pace: number[] | null;
  elevation: number[] | null;
  heartRate: number[] | null;
}

/** Buckets the workout's samples into BUCKET_COUNT equal time slices,
 *  averaging within each bucket and gap-filling ones with no samples (see
 *  `fillGaps`). Returns raw values in each series' own real unit — no
 *  normalization; `CombinedChart` builds each series' own axis domain from
 *  these. Returns null for a series with no data at all (e.g. heart rate
 *  with no monitor connected) so it's left off the chart and legend
 *  entirely, rather than drawn as a flat or gap-ridden line. */
function useChartSeries(samples: WorkoutSample[], totalElapsedS: number): ChartSeries | null {
  return useMemo(() => {
    if (samples.length === 0 || totalElapsedS <= 0) return null;

    const bucketSeconds = totalElapsedS / BUCKET_COUNT;
    const paceSum = new Array<number>(BUCKET_COUNT).fill(0);
    const paceCount = new Array<number>(BUCKET_COUNT).fill(0);
    const elevSum = new Array<number>(BUCKET_COUNT).fill(0);
    const elevCount = new Array<number>(BUCKET_COUNT).fill(0);
    const hrSum = new Array<number>(BUCKET_COUNT).fill(0);
    const hrCount = new Array<number>(BUCKET_COUNT).fill(0);

    for (const sample of samples) {
      const bucket = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(sample.elapsedS / bucketSeconds)));

      const paceMinPerKm = paceFromSpeed(sample.speedKph);
      if (paceMinPerKm !== undefined) {
        paceSum[bucket] += Math.min(paceMinPerKm * KM_PER_MILE, PACE_MAX_MIN_PER_MILE);
        paceCount[bucket] += 1;
      }
      if (sample.elevationM !== undefined) {
        elevSum[bucket] += sample.elevationM / METRES_PER_FOOT;
        elevCount[bucket] += 1;
      }
      if (sample.heartRateBpm !== undefined) {
        hrSum[bucket] += sample.heartRateBpm;
        hrCount[bucket] += 1;
      }
    }

    const pace = fillGaps(paceSum.map((sum, i) => (paceCount[i] > 0 ? sum / paceCount[i] : undefined)));
    const elevation = fillGaps(elevSum.map((sum, i) => (elevCount[i] > 0 ? sum / elevCount[i] : undefined)));
    const heartRate = fillGaps(hrSum.map((sum, i) => (hrCount[i] > 0 ? sum / hrCount[i] : undefined)));

    return { pace, elevation, heartRate };
  }, [samples, totalElapsedS]);
}

/** Linearly interpolates across buckets with no samples (nearest known
 *  neighbors on each side; flat-extends at the ends) so every series is a
 *  continuous curve for smoothing — a decorative shape, not an analytical
 *  chart, so this is preferable to a broken line. Returns null if the
 *  series has no data anywhere in the run. */
function fillGaps(values: (number | undefined)[]): number[] | null {
  const known = values.map((v, i) => (v !== undefined ? i : -1)).filter((i) => i >= 0);
  if (known.length === 0) return null;

  const result = [...values];
  for (let i = 0; i < result.length; i += 1) {
    if (result[i] !== undefined) continue;
    let prev = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (result[j] !== undefined) {
        prev = j;
        break;
      }
    }
    let next = -1;
    for (let j = i + 1; j < result.length; j += 1) {
      if (result[j] !== undefined) {
        next = j;
        break;
      }
    }
    if (prev === -1) result[i] = result[next];
    else if (next === -1) result[i] = result[prev];
    else {
      const t = (i - prev) / (next - prev);
      result[i] = (result[prev] as number) + t * ((result[next] as number) - (result[prev] as number));
    }
  }
  return result as number[];
}

/**
 * Maps a value's fractional position within its own series domain — 0 at
 * the domain min, 1 at the domain max, same shape as `niceDomain`'s
 * min/max — to a y coordinate in plot space. Takes a fraction rather than
 * the raw value so pace, elevation and heart rate (three different units,
 * three different domains) can share one function: each caller does its
 * own `(value - domainMin) / (domainMax - domainMin)` first.
 *
 * Two things happen here, both requested directly: `invert` flips which
 * end of the domain plots at the top (pace: the smaller, faster number
 * plots higher — same convention workout-chart.tsx uses — heart rate and
 * elevation plot the ordinary way, bigger is higher), and
 * TOP_PADDING_FRACTION compresses the whole usable range into the bottom
 * 84% of the chart's height, so even a series pinned at its own max stops
 * short of the very top edge instead of touching it.
 */
function valueToY(frac: number, invert: boolean): number {
  const upFrac = invert ? 1 - frac : frac;
  return CHART_PLOT_H - upFrac * TOP_PADDING_FRACTION * CHART_PLOT_H;
}

/** Raw series values, plus that series' own domain and invert flag, to
 *  plot-space points — replaces the old shared-[0,1]-axis `toPoints` now
 *  that pace and heart rate carry real domains (see `valueToY` above). */
function toPoints(values: number[], domainMin: number, domainMax: number, invert: boolean): [number, number][] {
  const span = Math.max(1e-6, domainMax - domainMin);
  const n = values.length;
  return values.map((value, i) => {
    const frac = (value - domainMin) / span;
    return [n > 1 ? (i / (n - 1)) * CHART_PLOT_W : CHART_PLOT_W / 2, valueToY(frac, invert)];
  });
}

/** Catmull-Rom-to-Bezier smoothing (standard 1/6-tension conversion) — turns
 *  the bucketed points into a soft curve rather than a jagged polyline,
 *  which is most of what "beautify this chart" means for a shape this
 *  small. */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;

  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/** Closes a line path into a filled area anchored to the plot's bottom
 *  edge — used only for elevation, drawn as a soft terrain silhouette
 *  behind the pace/heart-rate lines. */
function areaPath(linePath: string, points: [number, number][]): string {
  if (points.length === 0) return "";
  const firstX = points[0][0].toFixed(2);
  const lastX = points[points.length - 1][0].toFixed(2);
  return `${linePath} L ${lastX} ${CHART_PLOT_H} L ${firstX} ${CHART_PLOT_H} Z`;
}

function CombinedChart({ chart, totalElapsedS }: { chart: ChartSeries; totalElapsedS: number }) {
  // Real, rounded axis domains for the two metrics that get a labeled axis
  // — same niceDomain() workout-chart.tsx uses for its own mini-charts, so
  // the tick math (and the "clean numbers, evenly spaced" guarantee) is
  // shared rather than reimplemented. Elevation gets a plain raw min/max:
  // it's unlabeled, so it doesn't need rounded ticks, just a sensible range.
  const paceDomain = chart.pace ? niceDomain(Math.min(...chart.pace), Math.max(...chart.pace)) : null;
  const heartRateDomain = chart.heartRate
    ? niceDomain(Math.min(...chart.heartRate), Math.max(...chart.heartRate))
    : null;
  const elevationDomain = chart.elevation
    ? { min: Math.min(...chart.elevation), max: Math.max(...chart.elevation) }
    : null;

  const paceLine = pathFor(chart.pace, paceDomain, true);
  const heartRateLine = pathFor(chart.heartRate, heartRateDomain, false);
  const elevation = pathFor(chart.elevation, elevationDomain, false);

  if (!elevation && !paceLine && !heartRateLine) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-4">
        {paceLine ? <ChartLegendEntry color={PACE_COLOR} label="Pace" /> : null}
        {elevation ? <ChartLegendEntry color={ELEVATION_COLOR} label="Elevation" /> : null}
        {heartRateLine ? <ChartLegendEntry color={HEART_RATE_COLOR} label="Heart rate" /> : null}
      </div>

      <div className="flex items-stretch gap-1.5" style={{ height: CHART_PLOT_H }}>
        {/* Left axis: pace, in min/mi, real rounded ticks via niceDomain. */}
        <div className="relative shrink-0" style={{ width: AXIS_LABEL_WIDTH, height: CHART_PLOT_H }}>
          {paceLine && paceDomain
            ? paceDomain.ticks.map((tick) => (
                <AxisTickLabel key={tick} y={tickY(tick, paceDomain, true)} align="right">
                  {formatMinSec(tick)}
                </AxisTickLabel>
              ))
            : null}
        </div>

        <svg
          viewBox={`0 0 ${CHART_PLOT_W} ${CHART_PLOT_H}`}
          preserveAspectRatio="none"
          className="min-w-0 flex-1"
          style={{ height: CHART_PLOT_H }}
          role="img"
          aria-label="Pace, elevation and heart rate over the course of the run"
        >
          {elevation ? <path d={areaPath(elevation.line, elevation.points)} fill={ELEVATION_COLOR} opacity={0.16} /> : null}
          {elevation ? (
            <path d={elevation.line} fill="none" stroke={ELEVATION_COLOR} strokeWidth={2} opacity={0.85} />
          ) : null}
          {paceLine ? (
            <path
              d={paceLine.line}
              fill="none"
              stroke={PACE_COLOR}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {heartRateLine ? (
            // Deliberately thinner than the pace line — see the color
            // comment above: shape (thin line vs. pace's bolder stroke and
            // elevation's fill) is the secondary encoding standing in for
            // the CVD separation brown/red can't pass on their own.
            <path
              d={heartRateLine.line}
              fill="none"
              stroke={HEART_RATE_COLOR}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>

        {/* Right axis: heart rate, in bpm, rounded to whole ticks. */}
        <div className="relative shrink-0" style={{ width: AXIS_LABEL_WIDTH, height: CHART_PLOT_H }}>
          {heartRateLine && heartRateDomain
            ? heartRateDomain.ticks.map((tick) => (
                <AxisTickLabel key={tick} y={tickY(tick, heartRateDomain, false)} align="left">
                  {Math.round(tick)}
                </AxisTickLabel>
              ))
            : null}
        </div>
      </div>

      <div
        className="flex justify-between text-[9px]"
        style={{ color: "rgba(255, 255, 255, 0.4)", paddingLeft: AXIS_LABEL_WIDTH + 6, paddingRight: AXIS_LABEL_WIDTH + 6 }}
      >
        <span>0:00</span>
        {/* shareTimeValue (not formatDuration) so this label stays
         *  consistent with the hero row's Time value above — both drop
         *  seconds past an hour rather than one truncating and the other not. */}
        <span>{shareTimeValue(totalElapsedS)}</span>
      </div>
    </div>
  );
}

/** A tick's raw value to its y coordinate — same fraction-of-domain math
 *  `toPoints` uses for the line itself, so axis labels always land exactly
 *  on the pixel their gridline would have been at, without an actual
 *  gridline drawn (those were removed per direct request). */
function tickY(tick: number, domain: { min: number; max: number }, invert: boolean): number {
  const span = Math.max(1e-6, domain.max - domain.min);
  return valueToY((tick - domain.min) / span, invert);
}

/** Bundles a series' smoothed line path with its (already plot-space)
 *  points — `areaPath` needs the points too, to know where to close the
 *  fill against the plot's bottom edge. Returns null if the series has no
 *  data (its domain is then also null, since `CombinedChart` derives both
 *  from the same presence check). */
function pathFor(
  values: number[] | null,
  domain: { min: number; max: number } | null,
  invert: boolean,
): { line: string; points: [number, number][] } | null {
  if (!values || !domain) return null;
  const points = toPoints(values, domain.min, domain.max, invert);
  return { line: smoothPath(points), points };
}

function AxisTickLabel({ y, align, children }: { y: number; align: "left" | "right"; children: ReactNode }) {
  const style: CSSProperties = {
    top: `${(y / CHART_PLOT_H) * 100}%`,
    transform: "translateY(-50%)",
    color: "rgba(255, 255, 255, 0.4)",
    textAlign: align,
    width: AXIS_LABEL_WIDTH,
  };
  if (align === "right") style.right = 0;
  else style.left = 0;
  return (
    <span className="absolute font-mono text-[9px] leading-none tabular-nums" style={style}>
      {children}
    </span>
  );
}

function ChartLegendEntry({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-medium"
      style={{ color: "rgba(255, 255, 255, 0.7)" }}
    >
      <span className="inline-block size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
