"use client";

import { Settings2 } from "lucide-react";

import { useWorkout } from "@/components/workout-provider";
import { useDraftValue } from "@/hooks/use-draft-value";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { HEART_RATE_ZONES, zoneBoundsBpm } from "@/lib/workout/hr-zones";

const MIN_MAX_HEART_RATE = 140;
const MAX_MAX_HEART_RATE = 220;

/** Maximum heart rate, which is the only input the zone model needs. */
export function RunnerSettings() {
  const { maxHeartRateBpm, setMaxHeartRateBpm } = useWorkout();
  const [draft, setDraft] = useDraftValue(maxHeartRateBpm);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="size-4" />
          Zone settings
        </CardTitle>
        <CardDescription>
          Zones are percentages of your maximum heart rate. Raw samples go into the FIT file either
          way, so changing this only affects the zone breakdown.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-end justify-between">
            <Label htmlFor="max-heart-rate" className="text-xs uppercase tracking-wide">
              Maximum heart rate
            </Label>
            <span className="font-mono text-lg font-bold tabular-nums">
              {draft}
              <span className="text-muted-foreground ml-1 text-xs font-normal">bpm</span>
            </span>
          </div>
          <Slider
            id="max-heart-rate"
            value={[draft]}
            min={MIN_MAX_HEART_RATE}
            max={MAX_MAX_HEART_RATE}
            step={1}
            aria-label="Maximum heart rate"
            onValueChange={(value) => setDraft(typeof value === "number" ? value : value[0])}
            onValueCommitted={(value) =>
              setMaxHeartRateBpm(typeof value === "number" ? value : value[0])
            }
          />
        </div>

        <ul className="space-y-1">
          {HEART_RATE_ZONES.map((zone) => {
            const { lowerBpm, upperBpm } = zoneBoundsBpm(zone, draft);
            return (
              <li key={zone.index} className="flex items-center gap-2 text-xs">
                <span aria-hidden className={`size-2 rounded-full ${zone.barClass}`} />
                <span className="font-medium">{zone.name}</span>
                <span className="text-muted-foreground">{zone.description}</span>
                <span className="text-muted-foreground ml-auto font-mono tabular-nums">
                  {lowerBpm}
                  {upperBpm ? `–${upperBpm}` : "+"}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
