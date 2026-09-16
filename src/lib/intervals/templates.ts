import { INTERVAL_WORKOUT_FILE_VERSION, INTERVAL_WORKOUT_SCHEMA } from "./types";
import type { IntervalBlock, IntervalLeg, IntervalWorkoutFile, SingleBlock, SingleSegmentType, WorkoutBlock } from "./types";

/** Quick-start workouts offered in the builder, so most runners never have to
 *  add a block from scratch. Values match what was worked out and confirmed
 *  screenshot-by-screenshot against the interval-builder mockup. */

function single(
  type: SingleSegmentType,
  speedMph: number,
  inclinePercent: number,
  durationSec: number,
): SingleBlock {
  return { kind: "single", type, speedMph, inclinePercent, durationSec, reps: 1 };
}

function interval(reps: number, work: IntervalLeg, rest: IntervalLeg): IntervalBlock {
  return { kind: "interval", reps, work, rest };
}

export interface WorkoutTemplate {
  name: string;
  blocks: WorkoutBlock[];
}

export const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    name: "5×1 / 2 easy",
    blocks: [
      single("warmup", 6.5, 0, 300),
      interval(5, { speedMph: 8, inclinePercent: 0, durationSec: 60 }, { speedMph: 6, inclinePercent: 0, durationSec: 120 }),
      single("cooldown", 5.5, 0, 300),
    ],
  },
  {
    name: "Pyramid",
    blocks: [
      single("warmup", 6.0, 0, 300),
      single("steady", 6.5, 0, 240),
      single("steady", 7.0, 0, 180),
      single("steady", 7.5, 0, 120),
      single("steady", 8.0, 0, 60),
      single("steady", 7.5, 0, 120),
      single("steady", 7.0, 0, 180),
      single("steady", 6.5, 0, 240),
      single("cooldown", 6.0, 0, 300),
    ],
  },
  {
    name: "Easy 30",
    blocks: [
      single("warmup", 5.5, 0, 180),
      single("steady", 6.5, 0, 1500),
      single("cooldown", 5.5, 0, 120),
    ],
  },
  {
    name: "Hill repeats",
    blocks: [
      single("warmup", 5.5, 1, 300),
      interval(5, { speedMph: 6.5, inclinePercent: 8, durationSec: 90 }, { speedMph: 6.0, inclinePercent: 0, durationSec: 90 }),
      single("cooldown", 5.5, 0, 300),
    ],
  },
];

/** Deep-clones a block list so handing a template (or an existing plan) to the
 *  builder never lets an edit there mutate the original array in place. */
export function cloneBlocks(blocks: WorkoutBlock[]): WorkoutBlock[] {
  return blocks.map((block) =>
    block.kind === "single"
      ? { ...block }
      : { ...block, work: { ...block.work }, rest: { ...block.rest } },
  );
}

export function templateToWorkoutFile(template: WorkoutTemplate): IntervalWorkoutFile {
  return {
    schema: INTERVAL_WORKOUT_SCHEMA,
    version: INTERVAL_WORKOUT_FILE_VERSION,
    name: template.name,
    blocks: cloneBlocks(template.blocks),
  };
}
