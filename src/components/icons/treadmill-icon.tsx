import type { SVGProps } from "react";

/**
 * The treadmill glyph used for the app's favicon / PWA icons
 * (public/icons/*.png, src/app/favicon.ico), traced into an SVG path so it
 * can be reused inline wherever a small, currentColor-aware icon is needed
 * (e.g. the header badge in src/app/page.tsx). Keep this in sync with the
 * static icon assets if that glyph ever changes.
 */
export function TreadmillIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.35 20.93 L21.66 21.27 L20.45 21.27 L20.58 22.18 L20.02 22.74 L16.75 22.74 L16.18 22.18 L16.31 21.27 L7.34 21.27 L7.47 22.18 L6.91 22.74 L3.72 22.74 L3.16 22.18 L3.29 21.27 L2.34 21.27 L1.35 20.63 L1.0 19.94 L1.09 18.99 L1.65 18.25 L2.34 17.91 L13.08 17.87 L8.33 5.36 L7.17 5.49 L6.82 5.31 L6.52 4.84 L6.82 4.02 L12.17 2.73 L12.86 2.29 L13.29 2.29 L13.85 2.77 L13.94 3.37 L13.47 3.93 L11.31 4.45 L11.09 4.67 L15.93 17.78 L21.92 18.0 L22.65 18.56 L23.0 19.25 L22.91 20.2 Z M6.61 3.03 L6.69 2.6 L7.0 2.38 L8.03 2.29 L12.0 1.35 L12.69 1.0 L12.95 1.0 L13.34 1.3 L13.34 1.65 L12.95 1.95 L7.6 3.16 L7.25 3.42 L6.82 3.33 Z"
      />
    </svg>
  );
}
