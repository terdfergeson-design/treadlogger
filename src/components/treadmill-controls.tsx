"use client";

import { Gauge, Minus, Plus, TrendingUp } from "lucide-react";

import { useWorkout } from "@/components/workout-provider";
import { useDraftValue } from "@/hooks/use-draft-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

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
    targetSpeedKph,
    targetInclinePercent,
    setTargetSpeed,
    setTargetIncline,
    speedRange,
    inclineRange,
  } = useWorkout();

  const connected = treadmill.connection === "connected";
  const inclineSupported = treadmill.features?.targets.inclination ?? true;
  const speedSupported = treadmill.features?.targets.speed ?? true;

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
      </CardHeader>

      <CardContent className="space-y-6">
        <ControlRow
          icon={Gauge}
          label="Target speed"
          value={targetSpeedKph}
          unit="km/h"
          decimals={1}
          min={speedRange.minKph}
          max={speedRange.maxKph}
          step={Math.max(0.1, speedRange.incrementKph)}
          actual={treadmill.data.speedKph}
          disabled={!connected || !speedSupported}
          onCommit={setTargetSpeed}
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
