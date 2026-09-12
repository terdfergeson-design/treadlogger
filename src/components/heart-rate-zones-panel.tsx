"use client";

import { HeartRateZones } from "@/components/heart-rate-zones";
import { useWorkout } from "@/components/workout-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Live zone breakdown. Hidden after a workout, where the summary shows it. */
export function HeartRateZonesPanel() {
  const { workout, heartRate, maxHeartRateBpm } = useWorkout();

  if (workout.state === "finished") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Heart rate zones</CardTitle>
        <CardDescription>Time accumulated in each zone during this workout.</CardDescription>
      </CardHeader>
      <CardContent>
        <HeartRateZones
          timeInZones={workout.timeInZones}
          maxHeartRateBpm={maxHeartRateBpm}
          currentBpm={heartRate.measurement?.heartRateBpm}
        />
      </CardContent>
    </Card>
  );
}
