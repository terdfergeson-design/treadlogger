"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

import { Gauge, Minus, Plus, RotateCcw, Settings, SlidersHorizontal, TrendingUp, Zap } from "lucide-react";

import { useWorkout } from "@/components/workout-provider";
import { useDraftValue } from "@/hooks/use-draft-value";
import { useInclinePresets, useSpeedPresets } from "@/hooks/use-belt-presets";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fromMachineSpeed,
  MACHINE_SPEED_UNIT_LABELS,
  MACHINE_SPEED_UNITS,
  toMachineSpeed,
  type MachineSpeedUnit,
} from "@/lib/ble/ftms/speed-units";
import { speedUnitLabel } from "@/lib/format";

/**
 * This app always displays and accepts input in US customary units, regardless
 * of the "Treadmill speed unit" setting below — that setting is a separate,
 * hardware-level correction for machines whose FTMS fields lie about their
 * unit, applied once the number crosses the GATT boundary. Conflating the two
 * would mean a runner's display preference could silently mis-drive the belt.
 */
const DISPLAY_UNIT = "mph";

/**
 * Speed and incline control.
 *
 * Every change is a write to the FTMS control point, so the slider commits on
 * release rather than on every pixel of drag — otherwise a single gesture would
 * queue dozens of commands the treadmill has to acknowledge one at a time.
 */
export function TreadmillControls() {
  const {
    treadmill,
    workout,
    targetSpeedKph,
    targetInclinePercent,
    setTargetSpeed,
    setTargetIncline,
    speedRange,
    inclineRange,
    machineSpeedUnit,
    setMachineSpeedUnit,
    commandSpeedUnit,
    setCommandSpeedUnit,
  } = useWorkout();
  const { values: speedPresets, setValue: setSpeedPreset, reset: resetSpeedPresets } = useSpeedPresets();
  const {
    values: inclinePresets,
    setValue: setInclinePreset,
    reset: resetInclinePresets,
  } = useInclinePresets();

  const connected = treadmill.connection === "connected";
  const inclineSupported = treadmill.features?.targets.inclination ?? true;
  const speedSupported = treadmill.features?.targets.speed ?? true;

  // This treadmill always begins a workout at 0.5 mph no matter what target
  // was requested beforehand, so a pre-start speed choice would be a lie —
  // the control stays locked until the workout is actually running (or
  // paused mid-run, where picking a resume speed is meaningful again).
  const workoutRunning = workout.state === "active" || workout.state === "paused";

  // The runner always dials in and reads mph; km/h stays the app's internal
  // currency (and separately, whatever the machine's own GATT fields need).
  const shown = (speedKph: number) => Number(toMachineSpeed(speedKph, DISPLAY_UNIT).toFixed(2));
  const commanded = (shownSpeed: number) => fromMachineSpeed(shownSpeed, DISPLAY_UNIT);

  // Speed presets are gated exactly like the speed slider — including the
  // pre-start lock. Incline presets follow the incline slider's own,
  // looser rule instead: no workout-running requirement.
  const speedPresetsDisabled = !connected || !speedSupported || !workoutRunning;
  const inclinePresetsDisabled = !connected || !inclineSupported;

  const applySpeedPreset = (speedMph: number) => void setTargetSpeed(commanded(speedMph));
  const applyInclinePreset = (inclinePercent: number) => void setTargetIncline(inclinePercent);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Belt control</CardTitle>
        <CardDescription>
          {connected
            ? treadmill.hasControl
              ? "Sent straight to the treadmill over the FTMS control point."
              : "The treadmill has not granted control, so these will be rejected."
            : "Connect a treadmill to drive speed and incline from here."}
        </CardDescription>
        <CardAction>
          <Popover>
            <PopoverTrigger
              aria-label="Treadmill unit quirks"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <Settings className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end">
              <PopoverHeader>
                <PopoverTitle>Treadmill unit quirks</PopoverTitle>
                <PopoverDescription>
                  Only change these if the numbers on this card disagree with the treadmill
                  itself — most machines never need this.
                </PopoverDescription>
              </PopoverHeader>
              <div className="space-y-3 pt-1">
                <MachineSpeedUnitSetting
                  label="Treadmill readout unit"
                  help="Leave this on km/h unless the belt speed shown here disagrees with the treadmill's own console."
                  unit={machineSpeedUnit}
                  setUnit={setMachineSpeedUnit}
                />
                <MachineSpeedUnitSetting
                  label="Target speed command unit"
                  help="Leave this on mph unless the belt runs faster or slower than the speed you set, even though the readout above is correct."
                  unit={commandSpeedUnit}
                  setUnit={setCommandSpeedUnit}
                />
              </div>
            </PopoverContent>
          </Popover>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
              <Zap className="size-3.5" />
              Quick presets
            </span>
            <PresetSettingsPopover
              speedPresets={speedPresets}
              setSpeedPreset={setSpeedPreset}
              resetSpeedPresets={resetSpeedPresets}
              speedMax={shown(speedRange.maxKph)}
              inclinePresets={inclinePresets}
              setInclinePreset={setInclinePreset}
              resetInclinePresets={resetInclinePresets}
              inclineMax={inclineRange.maxPercent}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Speed</p>
            <div className="grid grid-cols-3 gap-2">
              {speedPresets.map((speedMph, index) => (
                <PresetButton
                  key={index}
                  value={speedMph}
                  unit="mph"
                  disabled={speedPresetsDisabled}
                  onApply={() => applySpeedPreset(speedMph)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Incline</p>
            <div className="grid grid-cols-3 gap-2">
              {inclinePresets.map((inclinePercent, index) => (
                <PresetButton
                  key={index}
                  value={inclinePercent}
                  unit="%"
                  disabled={inclinePresetsDisabled}
                  onApply={() => applyInclinePreset(inclinePercent)}
                />
              ))}
            </div>
          </div>

          <p className="text-muted-foreground text-[11px]">
            {connected
              ? "Speed presets apply once the workout starts — this treadmill always begins at 0.5 mph. Incline presets apply anytime."
              : "Connect a treadmill to use presets."}
          </p>
        </div>

        <ControlRow
          icon={Gauge}
          label="Target speed"
          value={shown(targetSpeedKph)}
          unit={speedUnitLabel(DISPLAY_UNIT)}
          decimals={1}
          min={shown(speedRange.minKph)}
          max={shown(speedRange.maxKph)}
          // The machine's real grid lives in its own native unit (often km/h
          // even on an mph-console machine). Flooring this to a round 0.1 in
          // the *display* unit would let the slider land on mph values that
          // don't sit on that grid, so the belt would silently round the
          // command to its nearest supported speed — a gap between what the
          // slider shows and what the belt actually settles at. The floor
          // here only guards against a machine reporting a zero increment.
          step={Math.max(0.01, shown(speedRange.incrementKph))}
          actual={
            treadmill.data.speedKph === undefined ? undefined : shown(treadmill.data.speedKph)
          }
          disabled={!connected || !speedSupported || !workoutRunning}
          disabledNote={
            connected && speedSupported && !workoutRunning
              ? "Locked until the workout starts — this treadmill always begins at 0.5 mph."
              : undefined
          }
          onCommit={(value) => setTargetSpeed(commanded(value))}
        />

        <ControlRow
          icon={TrendingUp}
          label="Target incline"
          value={targetInclinePercent}
          unit="%"
          decimals={1}
          min={inclineRange.minPercent}
          max={inclineRange.maxPercent}
          step={Math.max(0.5, inclineRange.incrementPercent)}
          actual={treadmill.data.inclinationPercent}
          disabled={!connected || !inclineSupported}
          disabledNote={
            connected && !inclineSupported ? "This treadmill has no adjustable incline." : undefined
          }
          onCommit={setTargetIncline}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Declares what the treadmill really means by one group of its FTMS speed
 * fields — either the Treadmill Data readout, or the Control Point's target
 * speed (which also governs Supported Speed Range and the status
 * characteristic's target-speed-changed field, since all three describe that
 * same control-point value).
 *
 * The spec says kilometres per hour throughout, but a machine built around a
 * mph console can put miles per hour in some or all of these fields instead,
 * in which case whichever direction is affected runs or reads a factor of
 * 1.609 off. These two groups are deliberately separate settings rather than
 * one: real hardware has turned up whose readout is spec-compliant km/h
 * while its Control Point reads mph regardless, so a single toggle cannot
 * describe both. Only the owner of the machine can tell which is which, so
 * each is a setting rather than a guess, and both live next to the controls
 * where the discrepancy shows up — now tucked behind the gear icon on this
 * card, since it's a one-time-per-machine setting rather than something a
 * runner touches every workout.
 */
function MachineSpeedUnitSetting({
  label,
  help,
  unit,
  setUnit,
}: {
  label: string;
  help: string;
  unit: MachineSpeedUnit;
  setUnit: (unit: MachineSpeedUnit) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {label}
        </p>
        <p className="text-muted-foreground mt-1 text-[11px]">{help}</p>
      </div>

      <Tabs value={unit} onValueChange={(value) => setUnit(value as MachineSpeedUnit)}>
        <TabsList>
          {MACHINE_SPEED_UNITS.map((option) => (
            <TabsTrigger key={option} value={option}>
              {MACHINE_SPEED_UNIT_LABELS[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

function ControlRow({
  icon: Icon,
  label,
  value,
  unit,
  decimals,
  min,
  max,
  step,
  actual,
  disabled,
  disabledNote,
  onCommit,
}: {
  icon: typeof Gauge;
  label: string;
  value: number;
  unit: string;
  decimals: number;
  min: number;
  max: number;
  step: number;
  actual?: number;
  disabled: boolean;
  disabledNote?: string;
  onCommit: (value: number) => Promise<void>;
}) {
  // Local state keeps the slider responsive while dragging; the committed value
  // flows back in from the provider once the treadmill has accepted it.
  const [draft, setDraft] = useDraftValue(value);

  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const nudge = (delta: number) => {
    const next = Number(clamp(draft + delta).toFixed(2));
    setDraft(next);
    void onCommit(next);
  };

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
          <Icon className="size-3.5" />
          {label}
        </span>
        <span className="font-mono text-xl font-bold tabular-nums">
          {draft.toFixed(decimals)}
          <span className="text-muted-foreground ml-1 text-xs font-normal">{unit}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={disabled || draft <= min}
          onClick={() => nudge(-step)}
        >
          <Minus className="size-4" />
        </Button>

        <Slider
          value={[draft]}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={label}
          onValueChange={(next) => setDraft(firstValue(next, draft))}
          onValueCommitted={(next) => void onCommit(firstValue(next, draft))}
          className="flex-1"
        />

        <Button
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={disabled || draft >= max}
          onClick={() => nudge(step)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <p className="text-muted-foreground mt-1.5 text-[11px]">
        {disabledNote ??
          (actual !== undefined
            ? `Treadmill reports ${actual.toFixed(decimals)} ${unit}`
            : `Range ${min.toFixed(decimals)}–${max.toFixed(decimals)} ${unit}`)}
      </p>
    </div>
  );
}

/**
 * One quick-dial button: taps a single preset value (speed or incline) in.
 *
 * Tapping it doesn't change how the button itself looks (its value doesn't
 * track anything live, unlike the slider above it), so without some kind of
 * acknowledgment a tap can look like it did nothing. `justApplied` flashes
 * the button to the app's primary green for a moment and fades back, purely
 * as a "yes, that registered" cue — it's local UI state, not tied to whether
 * the treadmill actually accepted the command (that's what the toasts from
 * `guard()` in `workout-provider.tsx` are for).
 */
function PresetButton({
  value,
  unit,
  disabled,
  onApply,
}: {
  value: number;
  unit: string;
  disabled: boolean;
  onApply: () => void;
}) {
  const [justApplied, setJustApplied] = useState(false);

  useEffect(() => {
    if (!justApplied) return;
    const timer = setTimeout(() => setJustApplied(false), 350);
    return () => clearTimeout(timer);
  }, [justApplied]);

  const handleClick = () => {
    onApply();
    setJustApplied(true);
  };

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={handleClick}
      className={`h-auto flex-col gap-0.5 py-3 leading-tight transition-colors duration-300 ${
        justApplied ? "border-primary bg-primary/15 text-primary" : ""
      }`}
    >
      <span className="font-mono text-lg font-bold tabular-nums">{formatPresetValue(value)}</span>
      <span className={`text-xs font-normal ${justApplied ? "text-primary" : "text-muted-foreground"}`}>
        {unit}
      </span>
    </Button>
  );
}

/** Trims a trailing ".0" (5 rather than 5.0) without ever rounding away a real decimal. */
function formatPresetValue(value: number): string {
  return Number(value.toFixed(1)).toString();
}

/**
 * A free-typing text draft for one numeric preset field, re-synced from the
 * outside (e.g. "Reset to defaults", or another field's commit) whenever the
 * source value actually changes.
 *
 * This deliberately isn't `type="number"` bound straight to a numeric draft:
 * a controlled number input snaps an in-progress edit like "7." or a cleared
 * field back to its last valid numeric value on every keystroke, since
 * neither parses to a number, which makes it impossible to select-all and
 * retype. Holding the raw string instead — parsed only on commit — lets the
 * field be edited freely.
 */
function usePresetFieldDraft(value: number): [string, (next: string) => void] {
  const [draft, setDraft] = useState(() => formatPresetValue(value));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    setDraft(formatPresetValue(value));
  }

  return [draft, setDraft];
}

/** Gear-style popover for editing what each speed and incline preset button dials in. */
function PresetSettingsPopover({
  speedPresets,
  setSpeedPreset,
  resetSpeedPresets,
  speedMax,
  inclinePresets,
  setInclinePreset,
  resetInclinePresets,
  inclineMax,
}: {
  speedPresets: number[];
  setSpeedPreset: (index: number, value: number) => void;
  resetSpeedPresets: () => void;
  speedMax: number;
  inclinePresets: number[];
  setInclinePreset: (index: number, value: number) => void;
  resetInclinePresets: () => void;
  inclineMax: number;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Preset settings"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      >
        <SlidersHorizontal className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverHeader>
          <PopoverTitle>Preset settings</PopoverTitle>
          <PopoverDescription>Set what each quick-preset button dials in.</PopoverDescription>
        </PopoverHeader>

        <div className="max-h-80 space-y-4 overflow-y-auto pt-1 pr-1">
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Speed (mph)
            </p>
            {speedPresets.map((value, index) => (
              <PresetNumberField
                key={index}
                index={index}
                value={value}
                max={speedMax}
                unit="mph"
                onChange={(next) => setSpeedPreset(index, next)}
              />
            ))}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Incline (%)
            </p>
            {inclinePresets.map((value, index) => (
              <PresetNumberField
                key={index}
                index={index}
                value={value}
                max={inclineMax}
                unit="%"
                onChange={(next) => setInclinePreset(index, next)}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={resetSpeedPresets}>
            <RotateCcw className="size-3.5" />
            Reset speed
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={resetInclinePresets}>
            <RotateCcw className="size-3.5" />
            Reset incline
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One editable row: a preset's index, a single value field, and its unit. */
function PresetNumberField({
  index,
  value,
  max,
  unit,
  onChange,
}: {
  index: number;
  value: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = usePresetFieldDraft(value);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    const next = clampValue(Number.isFinite(parsed) ? parsed : value, 0, Math.max(max, 0));

    setDraft(formatPresetValue(next));
    if (next !== value) onChange(next);
  };

  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className="text-muted-foreground w-4 shrink-0 text-right font-mono text-[11px]"
        aria-hidden
      >
        {index + 1}
      </span>

      <Input
        type="text"
        inputMode="decimal"
        aria-label={`Preset ${index + 1}, ${unit}`}
        className="h-7 flex-1 px-2 text-xs"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={commitOnEnter}
      />
      <span className="text-muted-foreground w-7 shrink-0 text-[10px]">{unit}</span>
    </div>
  );
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The slider reports a single value or an array depending on its arity. */
function firstValue(value: number | readonly number[], fallback: number): number {
  if (typeof value === "number") return value;
  return value[0] ?? fallback;
}
