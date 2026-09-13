"use client";

import { Gauge, Minus, Plus, Settings, TrendingUp } from "lucide-react";

import { useWorkout } from "@/components/workout-provider";
import { useDraftValue } from "@/hooks/use-draft-value";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
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

/** The slider reports a single value or an array depending on its arity. */
function firstValue(value: number | readonly number[], fallback: number): number {
  if (typeof value === "number") return value;
  return value[0] ?? fallback;
}
