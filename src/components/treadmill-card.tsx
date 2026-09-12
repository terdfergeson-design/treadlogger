"use client";

import { Activity, Bluetooth, Loader2, Plug, Unplug } from "lucide-react";

import { ConnectionStatus } from "@/components/connection-status";
import { useWorkout } from "@/components/workout-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIncline, formatSpeed } from "@/lib/format";

export function TreadmillCard() {
  const { treadmill, connectTreadmill, disconnectTreadmill, mode, bluetoothSupported, busy } =
    useWorkout();

  const connected = treadmill.connection === "connected";
  const connecting = treadmill.connection === "connecting" || treadmill.connection === "requesting";
  const blocked = mode === "bluetooth" && bluetoothSupported === false;

  return (
    <Card className="gap-4">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Activity className="size-4.5" />
            </span>
            <div>
              <CardTitle className="text-base">Treadmill</CardTitle>
              <ConnectionStatus state={treadmill.connection} className="mt-0.5" />
            </div>
          </div>
          {treadmill.hasControl ? (
            <Badge variant="secondary" className="shrink-0 text-[11px]">
              Control granted
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {connected ? (
          <>
            <p className="truncate text-sm font-medium">{treadmill.deviceName}</p>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Belt speed" value={`${formatSpeed(treadmill.data.speedKph)} km/h`} />
              <MiniStat
                label="Incline"
                value={`${formatIncline(treadmill.data.inclinationPercent)} %`}
              />
            </div>
            {treadmill.speedRange ? (
              <p className="text-muted-foreground text-xs">
                Supports {treadmill.speedRange.minKph.toFixed(1)}–
                {treadmill.speedRange.maxKph.toFixed(1)} km/h
                {treadmill.inclineRange
                  ? ` and ${treadmill.inclineRange.minPercent.toFixed(0)}–${treadmill.inclineRange.maxPercent.toFixed(0)} % incline`
                  : ""}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {blocked
              ? "Web Bluetooth is unavailable in this browser, so a treadmill cannot be paired here."
              : treadmill.error ??
                (mode === "simulator"
                  ? "Start the simulated treadmill to try the full workout flow without hardware."
                  : "Pair an FTMS treadmill to read speed, distance and incline, and to drive the belt from here.")}
          </p>
        )}

        {connected ? (
          <Button variant="outline" className="w-full" onClick={() => void disconnectTreadmill()}>
            <Unplug className="size-4" />
            Disconnect
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={blocked || connecting || busy}
            onClick={() => void connectTreadmill()}
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
                ? "Start simulated treadmill"
                : "Pair treadmill"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg px-3 py-2">
      <p className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</p>
      <p className="font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
