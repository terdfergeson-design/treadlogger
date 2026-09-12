"use client";

import { Bluetooth, FlaskConical } from "lucide-react";

import { useWorkout, type DeviceMode } from "@/components/workout-provider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Switches between real hardware and the simulator.
 *
 * Changing mode tears down both device connections and clears any recording, so
 * a simulated run can never be mixed into a real one.
 */
export function ModeSwitcher() {
  const { mode, setMode, workout } = useWorkout();

  // Switching mid-workout would discard the recording without warning.
  const locked = workout.state === "active" || workout.state === "paused";

  return (
    <Tabs value={mode} onValueChange={(value) => setMode(value as DeviceMode)}>
      <TabsList>
        <TabsTrigger value="bluetooth" disabled={locked}>
          <Bluetooth className="size-3.5" />
          Bluetooth
        </TabsTrigger>
        <TabsTrigger value="simulator" disabled={locked}>
          <FlaskConical className="size-3.5" />
          Simulator
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
