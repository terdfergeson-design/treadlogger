/**
 * Captures the pace track, the pace/elevation/heart-rate chart, and the
 * workout summary as one PNG, so a runner can save a picture of the run
 * alongside the FIT file.
 *
 * Renders with html2canvas-pro rather than plain html2canvas: this app's
 * Tailwind v4 theme is defined in OKLCH (see globals.css), and the original,
 * now largely unmaintained html2canvas can't parse that — it throws or
 * paints the wrong color. html2canvas-pro is a maintained fork built
 * specifically to add oklch()/lab()/color-mix() support, so it paints this
 * theme correctly in both light and dark mode.
 *
 * (An earlier version of this file avoided the extra dependency by cloning
 * each card, inlining every computed style, and rasterizing the result via
 * an SVG `<foreignObject>` loaded into an `<img>`. That kept failing with
 * "Tainted canvases may not be exported" on export — even after inlining
 * this app's self-hosted fonts as data URIs, so no non-`data:` reference
 * remained. Browsers are conservative about ever treating a
 * foreignObject-rendered SVG as origin-clean once it contains arbitrary
 * embedded HTML, which makes that approach fundamentally unreliable here.
 * html2canvas-pro paints directly with Canvas 2D calls instead of loading an
 * SVG image, so that failure mode doesn't apply.)
 */
import html2canvas from "html2canvas-pro";

/** DOM ids the three capture targets are given — see track-progress.tsx,
 *  workout-chart.tsx and workout-summary.tsx. Exported so those files and
 *  this one can't drift. */
export const TRACK_CAPTURE_ID = "track-progress-card";
export const CHART_CAPTURE_ID = "workout-chart-card";
export const SUMMARY_CAPTURE_ID = "workout-summary-card";

/** DOM id of the share-card capture target — see share-card.tsx. A single
 *  purpose-built element (not the app's own cards), so it's captured on its
 *  own rather than stacked via stackCanvases below. */
export const SHARE_CARD_CAPTURE_ID = "share-card";

/** Fixed export scale for the share card, independent of the capturing
 *  device's devicePixelRatio (unlike elementToCanvas's default below): the
 *  card is a fixed-size design (540 CSS px square, see share-card.tsx) meant
 *  to look the same wherever it's downloaded from, so it always renders at
 *  2x — a crisp 1080x1080 PNG, matching the square size Strava/Instagram
 *  expect for a shared photo. */
const SHARE_CARD_SCALE = 2;

/** Renders one element to a canvas. `scale` defaults to a crisp, capped
 *  device pixel ratio; pass a fixed value (see SHARE_CARD_SCALE) for an
 *  export that should look the same regardless of the capturing device. */
function elementToCanvas(
  element: HTMLElement,
  backgroundColor: string,
  scale: number = Math.min(2, window.devicePixelRatio || 1),
): Promise<HTMLCanvasElement> {
  return html2canvas(element, {
    backgroundColor,
    scale,
    // html2canvas-pro doesn't render Tailwind's `ring` utility (the
    // box-shadow-based outline the Card component uses — see
    // `ring-foreground/10` in ui/card.tsx) as a thin outline: it paints the
    // ring's low-opacity color as a full overlay across the whole element
    // instead, roughly doubling every card's background brightness in the
    // downloaded PNG (rgb(23,23,23) came out rgb(46,46,46) — confirmed by
    // sampling actual pixels with and without the ring present). `onclone`
    // lets html2canvas-pro's own DOM clone — used only for this capture,
    // never the live page — have its box-shadow stripped before rendering,
    // so the on-screen ring is untouched and the screenshot's card
    // backgrounds come out the correct color.
    onclone: (clonedDoc) => {
      clonedDoc.querySelectorAll<HTMLElement>('[data-slot="card"]').forEach((card) => {
        card.style.boxShadow = "none";
      });
    },
  });
}

/** Stacks canvases top to bottom into one image, centered and padded so the
 *  captured cards read as a single summary rather than loose screenshots. */
function stackCanvases(canvases: HTMLCanvasElement[], background: string): HTMLCanvasElement {
  const gap = 16;
  const padding = 16;
  const width = Math.max(...canvases.map((canvas) => canvas.width)) + padding * 2;
  const height =
    canvases.reduce((sum, canvas) => sum + canvas.height, 0) +
    gap * (canvases.length - 1) +
    padding * 2;

  const combined = document.createElement("canvas");
  combined.width = width;
  combined.height = height;
  const ctx = combined.getContext("2d");
  if (!ctx) throw new Error("This browser can't render a canvas");

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  let y = padding;
  for (const canvas of canvases) {
    const x = padding + (width - padding * 2 - canvas.width) / 2;
    ctx.drawImage(canvas, x, y);
    y += canvas.height + gap;
  }

  return combined;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode the screenshot"));
    }, "image/png");
  });
}

/** Hands a blob to the browser as a file download — the image counterpart to
 *  `downloadBytes` in lib/fit/download.ts. */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Captures the track (pace + lap splits), the pace/elevation/heart-rate
 * chart, and the workout summary's headline stats — skipping the
 * live-metrics and workout-controls cards, and the heart-rate-zones/FIT-file
 * card, that sit between and after them on the page — and saves the three
 * as one stacked PNG, in that order.
 */
export async function saveWorkoutScreenshot(fileName: string): Promise<void> {
  const track = document.getElementById(TRACK_CAPTURE_ID);
  const chart = document.getElementById(CHART_CAPTURE_ID);
  const summary = document.getElementById(SUMMARY_CAPTURE_ID);
  if (
    !(track instanceof HTMLElement) ||
    !(chart instanceof HTMLElement) ||
    !(summary instanceof HTMLElement)
  ) {
    throw new Error("Could not find the track, chart and workout summary to capture");
  }

  const background = window.getComputedStyle(document.body).backgroundColor || "#ffffff";
  const [trackCanvas, chartCanvas, summaryCanvas] = await Promise.all([
    elementToCanvas(track, background),
    elementToCanvas(chart, background),
    elementToCanvas(summary, background),
  ]);
  const combined = stackCanvases([trackCanvas, chartCanvas, summaryCanvas], background);
  const blob = await canvasToPngBlob(combined);
  downloadBlob(blob, fileName);
}

/**
 * Captures the purpose-built share card (see share-card.tsx) and saves it as
 * a PNG — a single square graphic designed for Strava/Instagram, distinct
 * from `saveWorkoutScreenshot`'s three-card stack of the app's own UI.
 *
 * The card carries its own fixed dark design entirely via inline styles and
 * literal rgb()/rgba() — deliberately never a Tailwind theme color class —
 * so none of root causes #1-#4 in the workout-screenshot-feature doc (the
 * app's oklch theme, Tailwind's own oklch default palette, and the Card
 * component's ring/box-shadow) can apply to it in the first place.
 */
export async function saveShareCard(fileName: string): Promise<void> {
  const card = document.getElementById(SHARE_CARD_CAPTURE_ID);
  if (!(card instanceof HTMLElement)) {
    throw new Error("Could not find the share card to capture");
  }

  // The card's own background is a fully opaque gradient (see share-card.tsx)
  // painted in its own inline styles, so this fallback fill is never actually
  // visible — html2canvas just needs some color behind a transparent element,
  // and getComputedStyle().backgroundColor reads as "transparent" for a
  // `background: linear-gradient(...)` shorthand, so it's not useful here.
  const canvas = await elementToCanvas(card, "rgb(9, 11, 10)", SHARE_CARD_SCALE);
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, fileName);
}
