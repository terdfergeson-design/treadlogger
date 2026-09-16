/**
 * On-disk shape for a saved interval workout.
 *
 * Chosen deliberately as plain, pretty-printed JSON rather than a binary or
 * XML format: a runner can open one in any text editor, hand-tweak a pace or
 * duration, and see immediately what changed in a git diff. JSON also needs
 * no new dependency — `JSON.parse`/`JSON.stringify` are all this module uses
 * — where a friendlier syntax (YAML, a custom DSL) would mean adding a parser
 * or writing one. If hand-authoring workouts from scratch turns out to be a
 * common workflow and the punctuation gets in the way, this is the layer to
 * swap; the block shape below stays the same either way.
 *
 * Speed and incline are stored in this app's *display* units — mph and
 * percent — the same units the interval builder's fields show, not the km/h
 * the rest of the app uses internally (see `format.ts`). A hand-typed "6.5"
 * reads the way a runner would say it out loud. Conversion to km/h happens
 * only when a block is actually sent to the treadmill, the same point where
 * `use-belt-presets.ts` converts its own mph presets.
 */

/** Identifies the file as one of these, independent of its extension. */
export const INTERVAL_WORKOUT_SCHEMA = "treadlogger.interval-workout";

/**
 * Bumped whenever the block shape changes in a way older code can't just
 * ignore. `parseIntervalWorkoutFile` rejects anything newer than this so a
 * future format change fails loudly instead of silently mis-reading fields.
 */
export const INTERVAL_WORKOUT_FILE_VERSION = 1;

/** A block that isn't a repeated work/rest pair — just runs once (or `reps` times) at one pace. */
export type SingleSegmentType = "warmup" | "steady" | "cooldown";

export interface SingleBlock {
  kind: "single";
  type: SingleSegmentType;
  speedMph: number;
  inclinePercent: number;
  durationSec: number;
  /** How many times this exact segment repeats back-to-back. Almost always 1. */
  reps: number;
}

/** One side (work or rest) of an interval block's repeated pair. */
export interface IntervalLeg {
  speedMph: number;
  inclinePercent: number;
  durationSec: number;
}

/** A work/rest pair repeated `reps` times, e.g. "6 × (1:00 hard / 2:00 easy)". */
export interface IntervalBlock {
  kind: "interval";
  reps: number;
  work: IntervalLeg;
  rest: IntervalLeg;
}

export type WorkoutBlock = SingleBlock | IntervalBlock;

export interface IntervalWorkoutFile {
  schema: typeof INTERVAL_WORKOUT_SCHEMA;
  version: typeof INTERVAL_WORKOUT_FILE_VERSION;
  name: string;
  blocks: WorkoutBlock[];
}
