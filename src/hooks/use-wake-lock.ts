"use client";

import { useEffect, useRef } from "react";

/**
 * Requests a screen wake lock for as long as `active` is true, so a phone
 * propped up next to the treadmill doesn't lock its screen mid-workout.
 *
 * The OS releases the lock the moment the tab loses visibility — the phone
 * screen turning off, or switching apps — so this also re-requests it on
 * `visibilitychange` once the tab is visible again. Unsupported browsers and
 * a refused request (low battery, some Android OEMs) both fail silently:
 * losing the wake lock should never surface as an error to a runner
 * mid-workout, only as their screen behaving the way it always has.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let cancelled = false;

    const requestLock = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // Refused (low battery, permissions policy, etc.) — the screen just
        // behaves as it always has, which is the pre-existing behavior anyway.
      }
    };

    void requestLock();

    // The system auto-releases the lock on hide and clears sentinelRef via
    // the listener above, so "no sentinel yet" is exactly the signal that a
    // fresh request is needed once the tab is visible again.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && sentinelRef.current === null) {
        void requestLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      void sentinel?.release();
    };
  }, [active]);
}
