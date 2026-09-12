"use client";

import { Battery, Bluetooth, Heart, Loader2, Plug, TriangleAlert, Unplug } from "lucide-react";

import { ConnectionStatus } from "@/components/connection-status";
import { useWorkout } from "@/components/workout-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHeartRate } from "@/lib/format";
import { zoneForHeartRate } from "@/lib/workout/hr-zones";

export function HeartRateCard() {
  const {
    heartRate,
    connectHeartRate,
    disconnectHeartRate,
    mode,
    bluetoothSupported,
    maxHeartRateBpm,
    busy,
  } = useWorkout();

  const connected = heartRate.connection === "connected";
  const connecting = heartRate.connection === "connecting" || heartRate.connection === "requesting";
  const blocked = mode === "bluetooth" && bluetoothSupported === false;

  const bpm = heartRate.measurement?.heartRateBpm;
  const zone = bpm === undefined ? null : zoneForHeartRate(bpm, maxHeartRateBpm);
  const contactLost = heartRate.measurement?.sensorContact === "not-detected";

  return (
    <Card className="gap-4">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
              <Heart className="size-4.5" />
            </span>
            <div>
              <CardTitle className="text-base">Heart rate</CardTitle>
              <ConnectionStatus state={heartRate.connection} className="mt-0.5" />
            </div>
          </div>
          {heartRate.batteryPercent !== undefined ? (
            <Badge variant="secondary" className="shrink-0 gap-1 text-[11px]">
              <Battery className="size-3" />
              {heartRate.batteryPercent}%
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {connected ? (
          <>
            <p className="truncate text-sm font-medium">
              {heartRate.deviceName}
              {heartRate.bodySensorLocation ? (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  · {heartRate.bodySensorLocation}
                </span>
              ) : null}
            </p>

            <div className="flex items-baseline gap-2">
              <span className="font-mono text-4xl leading-none font-bold tabular-nums">
                {formatHeartRate(bpm)}
              </span>
              <span className="text-muted-foreground text-sm">bpm</span>
              {zone ? (
                <span className={`ml-auto text-xs font-semibold ${zone.textClass}`}>
                  {zone.name} · {zone.description}
                </span>
              ) : null}
            </div>

            {contactLost ? (
              <p className="text-amber-600 dark:text-amber-400 flex items-start gap-1.5 text-xs">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                The strap is not detecting skin contact. Wet the electrodes and reseat it.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {blocked
              ? "Web Bluetooth is unavailable in this browser, so a strap cannot be paired here."
              : heartRate.error ??
                (mode === "simulator"
                  ? "Start the simulated strap to log heart rate that responds to belt speed and incline."
                  : "Pair a chest strap to log heart rate alongside the workout and into the FIT file.")}
          </p>
        )}

        {connected ? (
          <Button variant="outline" className="w-full" onClick={() => void disconnectHeartRate()}>
            <Unplug className="size-4" />
            Disconnect
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            disabled={blocked || connecting || busy}
            onClick={() => void connectHeartRate()}
          >
            {connecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : mode === "simulator" ? (
              <Plug className="size-4" />
            ) : (
              <Bluetooth className="size-4" />
            )}
            {connecting
              ? "Connecting…"
              : mode === "simulator"
                ? "Start simulated strap"
                : "Pair heart rate monitor"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
