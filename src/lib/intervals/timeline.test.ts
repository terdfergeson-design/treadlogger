import { describe, expect, it } from "vitest";
import { KM_PER_MILE } from "../ble/ftms/speed-units";
import { METRES_PER_FOOT } from "../format";
import { buildElevationProfile, buildTimeline, elevationAtSec, segmentAt, timelineTotalSec } from "./timeline";
import type { WorkoutBlock } from "./types";

const blocks: WorkoutBlock[] = [
  { kind: "single", type: "warmup", speedMph: 6, inclinePercent: 0, durationSec: 60, reps: 1 },
  {
    kind: "interval",
    reps: 2,
    work: { speedMph: 8, inclinePercent: 0, durationSec: 30 },
    rest: { speedMph: 5, inclinePercent: 0, durationSec: 20 },
  },
  { kind: "single", type: "cooldown", speedMph: 5, inclinePercent: 0, durationSec: 40, reps: 1 },
];

describe("buildTimeline", () => {
  it("flattens single and interval blocks into absolute-time segments", () => {
    const timeline = buildTimeline(blocks);

    expect(timeline.map((s) => [s.kind, s.label, s.startSec, s.endSec])).toEqual([
      ["warmup", "Warm up", 0, 60],
      ["work", "Work 1/2", 60, 90],
      ["rest", "Rest 1/2", 90, 110],
      ["work", "Work 2/2", 110, 140],
      ["rest", "Rest 2/2", 140, 160],
      ["cooldown", "Cooldown", 160, 200],
    ]);
  });

  it("assigns a stable, ascending index to every segment", () => {
    const timeline = buildTimeline(blocks);
    expect(timeline.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("tracks which original block each segment came from", () => {
    const timeline = buildTimeline(blocks);
    expect(timeline.map((s) => s.blockIndex)).toEqual([0, 1, 1, 1, 1, 2]);
  });

  it("expands a single block's reps into that many identical, individually labeled segments", () => {
    const repeated: WorkoutBlock[] = [
      { kind: "single", type: "steady", speedMph: 7, inclinePercent: 0, durationSec: 10, reps: 3 },
    ];
    const timeline = buildTimeline(repeated);
    expect(timeline.map((s) => [s.label, s.startSec, s.endSec])).toEqual([
      ["Steady 1/3", 0, 10],
      ["Steady 2/3", 10, 20],
      ["Steady 3/3", 20, 30],
    ]);
  });

  it("returns an empty timeline for no blocks", () => {
    expect(buildTimeline([])).toEqual([]);
  });
});

describe("timelineTotalSec", () => {
  it("is the end time of the last segment", () => {
    expect(timelineTotalSec(buildTimeline(blocks))).toBe(200);
  });

  it("is zero for an empty timeline", () => {
    expect(timelineTotalSec([])).toBe(0);
  });
});

describe("segmentAt", () => {
  const timeline = buildTimeline(blocks);

  it("finds the segment containing a given elapsed time", () => {
    expect(segmentAt(timeline, 0)?.label).toBe("Warm up");
    expect(segmentAt(timeline, 59.9)?.label).toBe("Warm up");
    expect(segmentAt(timeline, 60)?.label).toBe("Work 1/2");
    expect(segmentAt(timeline, 145)?.label).toBe("Rest 2/2");
  });

  it("clamps to the first segment before the plan starts", () => {
    expect(segmentAt(timeline, -10)?.label).toBe("Warm up");
  });

  it("clamps to the last segment once the plan has finished", () => {
    expect(segmentAt(timeline, 10_000)?.label).toBe("Cooldown");
  });

  it("returns undefined for an empty timeline", () => {
    expect(segmentAt([], 5)).toBeUndefined();
  });
});

describe("buildElevationProfile", () => {
  it("computes zero climb on the flat", () => {
    const flat: WorkoutBlock[] = [
      { kind: "single", type: "steady", speedMph: 6, inclinePercent: 0, durationSec: 600, reps: 1 },
    ];
    const profile = buildElevationProfile(buildTimeline(flat));
    expect(profile.map((p) => p.elevationFt)).toEqual([0, 0]);
  });

  it("uses the belt-surface distance and the incline's slope angle, not a small-angle shortcut", () => {
    // A 100% grade is a 45° incline, which makes the trig unambiguous: the
    // vertical component of the distance traveled is distance × sin(45°) —
    // noticeably less than distance × 1.00, which is what the app's other,
    // small-angle elevation calculation (WorkoutRecorder.altitudeM in
    // session.ts, used for a live recording) would give for the same grade.
    const steepBlock: WorkoutBlock[] = [
      { kind: "single", type: "steady", speedMph: 6, inclinePercent: 100, durationSec: 300, reps: 1 },
    ];
    const profile = buildElevationProfile(buildTimeline(steepBlock));

    const speedMPerS = (6 * KM_PER_MILE) / 3.6;
    const beltDistanceM = speedMPerS * 300;
    const expectedRiseM = beltDistanceM * Math.sin(Math.atan(1));
    const expectedFt = expectedRiseM / METRES_PER_FOOT;

    expect(profile[0]).toEqual({ atSec: 0, elevationFt: 0 });
    expect(profile[1].atSec).toBe(300);
    expect(profile[1].elevationFt).toBeCloseTo(expectedFt, 6);
    expect(profile[1].elevationFt).toBeLessThan(beltDistanceM / METRES_PER_FOOT);
  });

  it("accumulates across multiple segments, with one breakpoint per segment boundary", () => {
    const twoSegments: WorkoutBlock[] = [
      { kind: "single", type: "warmup", speedMph: 5, inclinePercent: 0, durationSec: 60, reps: 1 },
      { kind: "single", type: "steady", speedMph: 5, inclinePercent: 10, durationSec: 120, reps: 1 },
    ];
    const profile = buildElevationProfile(buildTimeline(twoSegments));
    expect(profile.map((p) => p.atSec)).toEqual([0, 60, 180]);
    expect(profile[1].elevationFt).toBe(0);
    expect(profile[2].elevationFt).toBeGreaterThan(0);
  });

  it("returns just the origin point for an empty timeline", () => {
    expect(buildElevationProfile([])).toEqual([{ atSec: 0, elevationFt: 0 }]);
  });
});

describe("elevationAtSec", () => {
  const profile = buildElevationProfile(
    buildTimeline([{ kind: "single", type: "steady", speedMph: 5, inclinePercent: 10, durationSec: 100, reps: 1 }]),
  );

  it("interpolates linearly within a segment, exactly (the profile is genuinely piecewise-linear)", () => {
    expect(elevationAtSec(profile, 0)).toBe(0);
    expect(elevationAtSec(profile, 50)).toBeCloseTo(profile[1].elevationFt / 2, 6);
    expect(elevationAtSec(profile, 100)).toBeCloseTo(profile[1].elevationFt, 6);
  });

  it("clamps before the start and after the end", () => {
    expect(elevationAtSec(profile, -10)).toBe(0);
    expect(elevationAtSec(profile, 10_000)).toBeCloseTo(profile[1].elevationFt, 6);
  });

  it("is zero for an empty profile", () => {
    expect(elevationAtSec([], 5)).toBe(0);
  });
});
