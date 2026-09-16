import { describe, expect, it } from "vitest";
import {
  IntervalWorkoutFileError,
  intervalWorkoutFileName,
  parseIntervalWorkoutFile,
  serializeIntervalWorkoutFile,
} from "./serialize";
import type { IntervalWorkoutFile } from "./types";

const sample: IntervalWorkoutFile = {
  schema: "treadlogger.interval-workout",
  version: 1,
  name: "5×1 / 2 easy",
  blocks: [
    { kind: "single", type: "warmup", speedMph: 6.5, inclinePercent: 0, durationSec: 300, reps: 1 },
    {
      kind: "interval",
      reps: 6,
      work: { speedMph: 8, inclinePercent: 0, durationSec: 60 },
      rest: { speedMph: 6, inclinePercent: 0, durationSec: 120 },
    },
    { kind: "single", type: "cooldown", speedMph: 5.5, inclinePercent: 0, durationSec: 300, reps: 1 },
  ],
};

describe("serializeIntervalWorkoutFile / parseIntervalWorkoutFile", () => {
  it("round-trips a workout through text unchanged", () => {
    const text = serializeIntervalWorkoutFile(sample);
    expect(parseIntervalWorkoutFile(text)).toEqual(sample);
  });

  it("pretty-prints so the file is hand-editable", () => {
    const text = serializeIntervalWorkoutFile(sample);
    expect(text).toContain("\n  \"blocks\": [");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("rejects text that isn't JSON", () => {
    expect(() => parseIntervalWorkoutFile("not json")).toThrow(IntervalWorkoutFileError);
  });

  it("rejects a file with the wrong schema", () => {
    const text = JSON.stringify({ ...sample, schema: "something-else" });
    expect(() => parseIntervalWorkoutFile(text)).toThrow(/schema/);
  });

  it("rejects a version newer than this build understands", () => {
    const text = JSON.stringify({ ...sample, version: 99 });
    expect(() => parseIntervalWorkoutFile(text)).toThrow(/version/);
  });

  it("rejects an unknown single-block type", () => {
    const bad = { ...sample, blocks: [{ ...sample.blocks[0], type: "sprint" }] };
    expect(() => parseIntervalWorkoutFile(JSON.stringify(bad))).toThrow(/blocks\[0\]\.type/);
  });

  it("rejects a non-positive duration", () => {
    const bad = { ...sample, blocks: [{ ...sample.blocks[0], durationSec: 0 }] };
    expect(() => parseIntervalWorkoutFile(JSON.stringify(bad))).toThrow(/durationSec/);
  });

  it("rejects an interval block missing its rest leg", () => {
    // `IntervalBlock` has no index signature, so TS won't allow a direct
    // `as Record<string, unknown>` cast (it can't prove the two types
    // overlap) — going through `unknown` first is what the compiler itself
    // suggests for "I know this is a plain object, trust me" casts like
    // this one, used here purely to destructure off a known field name for
    // a deliberately-malformed test fixture.
    const { rest: _rest, ...intervalWithoutRest } = sample.blocks[1] as unknown as Record<string, unknown>;
    const bad = { ...sample, blocks: [intervalWithoutRest] };
    expect(() => parseIntervalWorkoutFile(JSON.stringify(bad))).toThrow(/blocks\[0\]\.rest/);
  });

  it("rejects fractional reps", () => {
    const bad = { ...sample, blocks: [{ ...sample.blocks[1], reps: 2.5 }] };
    expect(() => parseIntervalWorkoutFile(JSON.stringify(bad))).toThrow(/reps/);
  });
});

describe("intervalWorkoutFileName", () => {
  it("slugifies the workout name", () => {
    expect(intervalWorkoutFileName("5×1 / 2 easy")).toBe("5-1-2-easy.treadlogger.json");
  });

  it("falls back to a generic name when nothing survives slugifying", () => {
    expect(intervalWorkoutFileName("★★★")).toBe("workout.treadlogger.json");
  });
});
