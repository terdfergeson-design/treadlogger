import {
  INTERVAL_WORKOUT_FILE_VERSION,
  INTERVAL_WORKOUT_SCHEMA,
  type IntervalBlock,
  type IntervalLeg,
  type IntervalWorkoutFile,
  type SingleBlock,
  type SingleSegmentType,
  type WorkoutBlock,
} from "./types";

/**
 * Reading and writing `.treadlogger.json` interval workout files.
 *
 * Validation here checks *shape* — right fields, right types, nothing
 * physically nonsensical (a negative duration, zero reps) — the same way a
 * malformed FIT file would fail to encode. It deliberately does not enforce
 * the interval builder's own UI bounds (its 0.5–12 mph slider range, say):
 * those are input-control limits, not file-format limits, and a hand-edited
 * file for an unusual treadmill shouldn't be rejected just because the
 * builder's stepper wouldn't have let you type that value. The builder is
 * free to clamp on load if it wants to.
 */

const KNOWN_SINGLE_TYPES: readonly SingleSegmentType[] = ["warmup", "steady", "cooldown"];

export class IntervalWorkoutFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntervalWorkoutFileError";
  }
}

function fail(path: string, detail: string): never {
  throw new IntervalWorkoutFileError(`${path}: ${detail}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, `expected a number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, path: string): number {
  const n = requireFiniteNumber(value, path);
  if (n <= 0) fail(path, `must be greater than zero, got ${n}`);
  return n;
}

function requireNonNegativeNumber(value: unknown, path: string): number {
  const n = requireFiniteNumber(value, path);
  if (n < 0) fail(path, `must not be negative, got ${n}`);
  return n;
}

function requirePositiveInteger(value: unknown, path: string): number {
  const n = requirePositiveNumber(value, path);
  if (!Number.isInteger(n)) fail(path, `must be a whole number, got ${n}`);
  return n;
}

function parseLeg(value: unknown, path: string): IntervalLeg {
  if (!isPlainObject(value)) fail(path, "expected an object");
  return {
    speedMph: requirePositiveNumber(value.speedMph, `${path}.speedMph`),
    inclinePercent: requireNonNegativeNumber(value.inclinePercent, `${path}.inclinePercent`),
    durationSec: requirePositiveNumber(value.durationSec, `${path}.durationSec`),
  };
}

function parseSingleBlock(value: Record<string, unknown>, path: string): SingleBlock {
  if (!KNOWN_SINGLE_TYPES.includes(value.type as SingleSegmentType)) {
    fail(`${path}.type`, `expected one of ${KNOWN_SINGLE_TYPES.join(", ")}, got ${JSON.stringify(value.type)}`);
  }
  return {
    kind: "single",
    type: value.type as SingleSegmentType,
    speedMph: requirePositiveNumber(value.speedMph, `${path}.speedMph`),
    inclinePercent: requireNonNegativeNumber(value.inclinePercent, `${path}.inclinePercent`),
    durationSec: requirePositiveNumber(value.durationSec, `${path}.durationSec`),
    reps: requirePositiveInteger(value.reps, `${path}.reps`),
  };
}

function parseIntervalBlock(value: Record<string, unknown>, path: string): IntervalBlock {
  return {
    kind: "interval",
    reps: requirePositiveInteger(value.reps, `${path}.reps`),
    work: parseLeg(value.work, `${path}.work`),
    rest: parseLeg(value.rest, `${path}.rest`),
  };
}

function parseBlock(value: unknown, path: string): WorkoutBlock {
  if (!isPlainObject(value)) fail(path, "expected an object");
  if (value.kind === "single") return parseSingleBlock(value, path);
  if (value.kind === "interval") return parseIntervalBlock(value, path);
  fail(`${path}.kind`, `expected "single" or "interval", got ${JSON.stringify(value.kind)}`);
}

/**
 * Parses and validates a `.treadlogger.json` file's text. Throws
 * `IntervalWorkoutFileError` with a field-qualified message on anything
 * malformed, so a hand-edit gone wrong ("durationSec": "1:00" instead of 60)
 * points straight at the offending field rather than failing deep inside the
 * interval builder later.
 */
export function parseIntervalWorkoutFile(text: string): IntervalWorkoutFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new IntervalWorkoutFileError(
      `not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!isPlainObject(raw)) fail("(root)", "expected an object");
  if (raw.schema !== INTERVAL_WORKOUT_SCHEMA) {
    fail("schema", `expected "${INTERVAL_WORKOUT_SCHEMA}", got ${JSON.stringify(raw.schema)}`);
  }
  if (typeof raw.version !== "number" || raw.version > INTERVAL_WORKOUT_FILE_VERSION) {
    fail(
      "version",
      `this build only understands up to version ${INTERVAL_WORKOUT_FILE_VERSION}, got ${JSON.stringify(raw.version)}`,
    );
  }
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    fail("name", "expected a non-empty string");
  }
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    fail("blocks", "expected a non-empty array");
  }

  return {
    schema: INTERVAL_WORKOUT_SCHEMA,
    version: INTERVAL_WORKOUT_FILE_VERSION,
    name: raw.name,
    blocks: raw.blocks.map((block, index) => parseBlock(block, `blocks[${index}]`)),
  };
}

/** Pretty-printed so the file reads and diffs like the hand-editable document it's meant to be. */
export function serializeIntervalWorkoutFile(workout: IntervalWorkoutFile): string {
  const ordered: IntervalWorkoutFile = {
    schema: INTERVAL_WORKOUT_SCHEMA,
    version: INTERVAL_WORKOUT_FILE_VERSION,
    name: workout.name,
    blocks: workout.blocks,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Turns a workout's name into a filesystem- and URL-safe file name. */
export function intervalWorkoutFileName(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workout";
  return `${slug}.treadlogger.json`;
}
