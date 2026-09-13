/**
 * Captures the pace track and the workout summary as one PNG, so a runner
 * can save a picture of the run alongside the FIT file.
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

/** DOM ids the two capture targets are given — see track-progress.tsx and
 *  workout-summary.tsx. Exported so those files and this one can't drift. */
export const TRACK_CAPTURE_ID = "track-progress-card";
export const SUMMARY_CAPTURE_ID = "workout-summary-card";

/** Renders one element to a canvas at a crisp, capped device pixel ratio. */
function elementToCanvas(element: HTMLElement, backgroundColor: string): Promise<HTMLCanvasElement> {
  return html2canvas(element, {
    backgroundColor,
    scale: Math.min(2, window.devicePixelRatio || 1),
  });
}

/** Stacks canvases top to bottom into one image, centered and padded so the
 *  two cards read as a single summary rather than two loose screenshots. */
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
 * Captures just the track (pace + lap splits) and the workout summary —
 * skipping the live-metrics and workout-controls cards that sit between
 * them on the page — and saves the pair as one PNG.
 */
export async function saveWorkoutScreenshot(fileName: string): Promise<void> {
  const track = document.getElementById(TRACK_CAPTURE_ID);
  const summary = document.getElementById(SUMMARY_CAPTURE_ID);
  if (!(track instanceof HTMLElement) || !(summary instanceof HTMLElement)) {
    throw new Error("Could not find the track and workout summary to capture");
  }

  const background = window.getComputedStyle(document.body).backgroundColor || "#ffffff";
  const [trackCanvas, summaryCanvas] = await Promise.all([
    elementToCanvas(track, background),
    elementToCanvas(summary, background),
  ]);
  const combined = stackCanvases([trackCanvas, summaryCanvas], background);
  const blob = await canvasToPngBlob(combined);
  downloadBlob(blob, fileName);
}
