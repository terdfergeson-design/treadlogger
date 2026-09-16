"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Minus, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDuration } from "@/lib/format";
import { cloneBlocks, WORKOUT_TEMPLATES, type WorkoutTemplate } from "@/lib/intervals/templates";
import { buildTimeline, timelineTotalSec } from "@/lib/intervals/timeline";
import { INTERVAL_WORKOUT_FILE_VERSION, INTERVAL_WORKOUT_SCHEMA } from "@/lib/intervals/types";
import type { IntervalWorkoutFile, SingleSegmentType, WorkoutBlock } from "@/lib/intervals/types";
import { cn } from "@/lib/utils";

/**
 * The interval workout builder: templates, a composer for adding one block
 * at a time, and the resulting plan as a reorderable list.
 *
 * This is a from-scratch React port of the interaction design worked out in
 * the standalone mockup (see the `interval-workout-file-format.md` project
 * doc), not a 1:1 port of its code — that version's pointer-driven drag-and-
 * drop reordering (mouse click-drag / touch long-press, snap-into-place, a
 * drop-to-delete zone) is deliberately left out of this first pass. Up/down/
 * duplicate/delete buttons on every block cover the same ground with far
 * less code and no gesture-conflict edge cases (scrolling the page vs.
 * dragging a card); drag-and-drop can be layered on top of this same block
 * list later if it's still wanted once this ships.
 */

const SPEED_MIN_MPH = 0.5;
const SPEED_MAX_MPH = 12;
const SPEED_STEP_MPH = 0.1;

const INCLINE_MIN_PERCENT = 0;
const INCLINE_MAX_PERCENT = 20;
const INCLINE_STEP_PERCENT = 1;

const DURATION_MIN_SEC = 15;
const DURATION_MAX_SEC = 3600;
const DURATION_STEP_SEC = 15;
const DURATION_PRESETS_SEC = [30, 60, 120, 180, 300, 600, 900, 1200, 1800];

const REPS_MIN = 1;
const REPS_MAX = 99;

interface LegDraft {
  speedMph: number;
  inclinePercent: number;
  durationSec: number;
}

const DEFAULT_SIMPLE_LEG: LegDraft = { speedMph: 6, inclinePercent: 0, durationSec: 300 };
const DEFAULT_WORK_LEG: LegDraft = { speedMph: 8, inclinePercent: 0, durationSec: 60 };
const DEFAULT_REST_LEG: LegDraft = { speedMph: 6, inclinePercent: 0, durationSec: 120 };

type ComposerType = "warmup" | "interval" | "steady" | "cooldown";

const COMPOSER_TYPES: { value: ComposerType; label: string; activeClass: string }[] = [
  { value: "warmup", label: "Warmup", activeClass: "bg-sky-500 text-white dark:bg-sky-400 dark:text-sky-950" },
  { value: "interval", label: "Interval", activeClass: "bg-rose-500 text-white dark:bg-rose-400 dark:text-rose-950" },
  { value: "steady", label: "Steady", activeClass: "bg-violet-500 text-white dark:bg-violet-400 dark:text-violet-950" },
  { value: "cooldown", label: "Cooldown", activeClass: "bg-blue-500 text-white dark:bg-blue-400 dark:text-blue-950" },
];

const SINGLE_META: Record<SingleSegmentType, { label: string; colorClass: string }> = {
  warmup: { label: "Warm up", colorClass: "border-l-sky-500 dark:border-l-sky-400" },
  steady: { label: "Steady", colorClass: "border-l-violet-500 dark:border-l-violet-400" },
  cooldown: { label: "Cooldown", colorClass: "border-l-blue-500 dark:border-l-blue-400" },
};

const INTERVAL_COLOR_CLASS = "border-l-rose-500 dark:border-l-rose-400";

/**
 * Local text draft for one numeric field, re-synced from the outside only
 * when the owned value actually changes — the same `usePresetFieldDraft`
 * pattern `treadmill-controls.tsx` uses for its preset editor, so mid-edit
 * text like "7." or a cleared field survives instead of snapping back to the
 * last valid value on every keystroke.
 */
function useFieldDraft(value: number, format: (value: number) => string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(() => format(value));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    setDraft(format(value));
  }

  return [draft, setDraft];
}

function formatDecimal(decimals: number) {
  return (value: number) => value.toFixed(decimals);
}

function StepperField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  decimals: number;
  suffix: string;
}) {
  const format = formatDecimal(decimals);
  const [draft, setDraft] = useFieldDraft(value, format);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    const next = Number.isFinite(parsed) ? Number(clamp(parsed).toFixed(decimals)) : value;
    setDraft(format(next));
    if (next !== value) onChange(next);
  };

  const nudge = (delta: number) => onChange(Number(clamp(value + delta).toFixed(decimals)));

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">{label}</p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={value <= min}
          onClick={() => nudge(-step)}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="size-3.5" />
        </Button>
        <div className="relative flex-1">
          <Input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label={label}
            className="pr-8 text-center font-mono text-sm tabular-nums"
          />
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px]">
            {suffix}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={value >= max}
          onClick={() => nudge(step)}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function parseDurationInput(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  const clock = /^(\d+):(\d{1,2})$/.exec(trimmed);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);

  const asSeconds = Number.parseFloat(trimmed);
  return Number.isFinite(asSeconds) ? Math.round(asSeconds) : fallback;
}

function DurationField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useFieldDraft(value, formatDuration);
  const clamp = (next: number) => Math.min(DURATION_MAX_SEC, Math.max(DURATION_MIN_SEC, next));

  const commit = (raw: string) => {
    const next = clamp(parseDurationInput(raw, value));
    setDraft(formatDuration(next));
    if (next !== value) onChange(next);
  };

  const nudge = (delta: number) => onChange(clamp(value + delta));

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Duration</p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={value <= DURATION_MIN_SEC}
          onClick={() => nudge(-DURATION_STEP_SEC)}
          aria-label="Decrease duration"
        >
          <Minus className="size-3.5" />
        </Button>
        <Input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Duration"
          className="flex-1 text-center font-mono text-sm tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={value >= DURATION_MAX_SEC}
          onClick={() => nudge(DURATION_STEP_SEC)}
          aria-label="Increase duration"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {DURATION_PRESETS_SEC.map((seconds) => (
          <button
            key={seconds}
            type="button"
            onClick={() => onChange(seconds)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              value === seconds
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted",
            )}
          >
            {formatDuration(seconds)}
          </button>
        ))}
      </div>
    </div>
  );
}

function LegFields({
  heading,
  leg,
  onChange,
}: {
  heading?: string;
  leg: LegDraft;
  onChange: (leg: LegDraft) => void;
}) {
  return (
    <div className="space-y-2">
      {heading ? <p className="text-xs font-semibold">{heading}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <StepperField
          label="Speed"
          value={leg.speedMph}
          onChange={(value) => onChange({ ...leg, speedMph: value })}
          min={SPEED_MIN_MPH}
          max={SPEED_MAX_MPH}
          step={SPEED_STEP_MPH}
          decimals={1}
          suffix="mph"
        />
        <StepperField
          label="Incline"
          value={leg.inclinePercent}
          onChange={(value) => onChange({ ...leg, inclinePercent: value })}
          min={INCLINE_MIN_PERCENT}
          max={INCLINE_MAX_PERCENT}
          step={INCLINE_STEP_PERCENT}
          decimals={0}
          suffix="%"
        />
      </div>
      <DurationField value={leg.durationSec} onChange={(value) => onChange({ ...leg, durationSec: value })} />
    </div>
  );
}

function blockSummary(block: WorkoutBlock): { label: string; detail: string; colorClass: string } {
  if (block.kind === "single") {
    const meta = SINGLE_META[block.type];
    return {
      label: meta.label,
      detail: `${block.speedMph.toFixed(1)} mph · ${block.inclinePercent.toFixed(0)}% · ${formatDuration(block.durationSec)}`,
      colorClass: meta.colorClass,
    };
  }

  return {
    label: `Interval ×${block.reps}`,
    detail: `Work ${block.work.speedMph.toFixed(1)} mph/${block.work.inclinePercent.toFixed(0)}% for ${formatDuration(block.work.durationSec)} · Rest ${block.rest.speedMph.toFixed(1)} mph/${block.rest.inclinePercent.toFixed(0)}% for ${formatDuration(block.rest.durationSec)}`,
    colorClass: INTERVAL_COLOR_CLASS,
  };
}

export function IntervalBuilder({
  onSave,
  onCancel,
}: {
  onSave: (workout: IntervalWorkoutFile) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [blocks, setBlocks] = useState<WorkoutBlock[]>([]);

  const [composerType, setComposerType] = useState<ComposerType>("warmup");
  const [reps, setReps] = useState(6);
  const [simpleLeg, setSimpleLeg] = useState<LegDraft>(DEFAULT_SIMPLE_LEG);
  const [workLeg, setWorkLeg] = useState<LegDraft>(DEFAULT_WORK_LEG);
  const [restLeg, setRestLeg] = useState<LegDraft>(DEFAULT_REST_LEG);

  const totalSec = useMemo(() => timelineTotalSec(buildTimeline(blocks)), [blocks]);

  const applyTemplate = (template: WorkoutTemplate) => {
    setBlocks(cloneBlocks(template.blocks));
    setName(template.name);
  };

  const addBlock = () => {
    const newBlock: WorkoutBlock =
      composerType === "interval"
        ? { kind: "interval", reps, work: { ...workLeg }, rest: { ...restLeg } }
        : {
            kind: "single",
            type: composerType,
            speedMph: simpleLeg.speedMph,
            inclinePercent: simpleLeg.inclinePercent,
            durationSec: simpleLeg.durationSec,
            reps: 1,
          };
    setBlocks((prev) => [...prev, newBlock]);
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    setBlocks((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const duplicateBlock = (index: number) => {
    setBlocks((prev) => {
      const [clone] = cloneBlocks([prev[index]]);
      const next = [...prev];
      next.splice(index + 1, 0, clone);
      return next;
    });
  };

  const deleteBlock = (index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Give the workout a name first");
      return;
    }
    if (blocks.length === 0) {
      toast.error("Add at least one block first");
      return;
    }
    onSave({ schema: INTERVAL_WORKOUT_SCHEMA, version: INTERVAL_WORKOUT_FILE_VERSION, name: trimmedName, blocks });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Workout name"
          aria-label="Workout name"
          className="sm:flex-1"
        />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            <Save className="size-4" />
            Save workout
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Templates</p>
        <div className="flex flex-wrap gap-1.5">
          {WORKOUT_TEMPLATES.map((template) => (
            <Button key={template.name} type="button" variant="outline" size="sm" onClick={() => applyTemplate(template)}>
              {template.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Block type">
          {COMPOSER_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              role="radio"
              aria-checked={composerType === type.value}
              onClick={() => setComposerType(type.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                composerType === type.value ? type.activeClass : "bg-muted/60 text-muted-foreground hover:bg-muted",
              )}
            >
              {type.label}
            </button>
          ))}
        </div>

        {composerType === "interval" ? (
          <div className="space-y-3">
            <div className="max-w-32">
              <StepperField label="Repeats" value={reps} onChange={setReps} min={REPS_MIN} max={REPS_MAX} step={1} decimals={0} suffix="×" />
            </div>
            <LegFields heading="Work" leg={workLeg} onChange={setWorkLeg} />
            <LegFields heading="Rest" leg={restLeg} onChange={setRestLeg} />
          </div>
        ) : (
          <LegFields leg={simpleLeg} onChange={setSimpleLeg} />
        )}

        <Button type="button" className="w-full" onClick={addBlock}>
          <Plus className="size-4" />
          Add block
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Plan</p>
          <p className="text-muted-foreground text-[11px] tabular-nums">
            {blocks.length} block{blocks.length === 1 ? "" : "s"} · {formatDuration(totalSec)} total
          </p>
        </div>

        {blocks.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed py-6 text-center text-xs">
            Add a block above, or start from a template.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {blocks.map((block, index) => {
              const summary = blockSummary(block);
              return (
                <li
                  key={index}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border-l-4 bg-muted/30 py-2 pr-2 pl-3",
                    summary.colorClass,
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{summary.label}</p>
                    <p className="text-muted-foreground truncate text-xs">{summary.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      onClick={() => moveBlock(index, -1)}
                      aria-label="Move block up"
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === blocks.length - 1}
                      onClick={() => moveBlock(index, 1)}
                      aria-label="Move block down"
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => duplicateBlock(index)}
                      aria-label="Duplicate block"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => deleteBlock(index)}
                      aria-label="Delete block"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
