"use client";

import { CircleStop, Loader2, Pause, Play, RotateCcw } from "lucide-react";

import { useWorkout } from "@/components/workout-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function WorkoutControls() {
  const {
    workout,
    treadmill,
    startWorkout,
    pauseWorkout,
    resumeWorkout,
    finishWorkout,
    discardWorkout,
    busy,
  } = useWorkout();

  const treadmillConnected = treadmill.connection === "connected";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {workout.state === "idle" ? (
          <>
            <Button
              size="lg"
              className="flex-1"
              disabled={busy || !treadmillConnected}
              onClick={() => void startWorkout()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Start workout
            </Button>
            <p className="text-muted-foreground text-xs sm:max-w-56">
              {treadmillConnected
                ? "Starts the belt and begins logging a sample every second."
                : "Connect a treadmill first — bluetooth or simulator — to start a workout."}
            </p>
          </>
        ) : null}

        {workout.state === "active" ? (
          <>
            <Button
              size="lg"
              variant="secondary"
              className="flex-1"
              disabled={busy}
              onClick={() => void pauseWorkout()}
            >
              <Pause className="size-4" />
              Pause
            </Button>
            <Button
              size="lg"
              variant="destructive"
              className="flex-1"
              disabled={busy}
              onClick={() => void finishWorkout()}
            >
              <CircleStop className="size-4" />
              Finish
            </Button>
          </>
        ) : null}

        {workout.state === "paused" ? (
          <>
            <Button
              size="lg"
              className="flex-1"
              disabled={busy}
              onClick={() => void resumeWorkout()}
            >
              <Play className="size-4" />
              Resume
            </Button>
            <Button
              size="lg"
              variant="destructive"
              className="flex-1"
              disabled={busy}
              onClick={() => void finishWorkout()}
            >
              <CircleStop className="size-4" />
              Finish
            </Button>
          </>
        ) : null}

        {workout.state === "finished" ? (
          <>
            <Button
              size="lg"
              className="flex-1"
              disabled={busy || !treadmillConnected}
              onClick={() => void startWorkout()}
            >
              <Play className="size-4" />
              Start another workout
            </Button>
            <Button size="lg" variant="ghost" onClick={discardWorkout}>
              <RotateCcw className="size-4" />
              Clear
            </Button>
            {!treadmillConnected ? (
              <p className="text-muted-foreground text-xs sm:max-w-56">
                Connect a treadmill first — bluetooth or simulator — to start another.
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
