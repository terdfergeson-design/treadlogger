"use client";

import { FlaskConical, Info, ShieldAlert } from "lucide-react";

import { useWorkout } from "@/components/workout-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Explains the two ways Web Bluetooth can be unavailable, and offers the
 * simulator as a way through either of them.
 */
export function BrowserSupportNotice() {
  const { mode, bluetoothSupported, secureContext, setMode } = useWorkout();

  if (mode === "simulator") {
    return (
      <Alert>
        <FlaskConical />
        <AlertTitle>Simulator mode</AlertTitle>
        <AlertDescription>
          Both devices are faked in the browser. Speed, incline, distance, calories and heart rate
          come from a simulated runner, streamed as the same Bluetooth payloads a real treadmill and
          chest strap send. Exports are marked as simulated.
        </AlertDescription>
      </Alert>
    );
  }

  // Still probing after mount; saying nothing beats flashing a wrong warning.
  if (bluetoothSupported === null) return null;

  if (!bluetoothSupported) {
    return (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>This browser cannot use Web Bluetooth</AlertTitle>
        <AlertDescription>
          <p>
            Pairing needs Chrome, Edge, Opera or another Chromium browser on desktop or Android.
            Safari and Firefox do not implement Web Bluetooth, and it is unavailable on iOS.
          </p>
          <p>
            On a Chromium browser, open <code className="font-mono">chrome://flags</code>, enable{" "}
            <strong>Experimental Web Platform features</strong>, and relaunch the browser.
          </p>
          <Button variant="outline" size="sm" onClick={() => setMode("simulator")}>
            <FlaskConical className="size-3.5" />
            Try simulator mode instead
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!secureContext) {
    return (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>Bluetooth needs a secure context</AlertTitle>
        <AlertDescription>
          Open this app over https, or on <code className="font-mono">localhost</code>. A plain-HTTP
          page served from a LAN address cannot request Bluetooth devices.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <Info />
      <AlertTitle>Pair each device separately</AlertTitle>
      <AlertDescription>
        The browser asks permission once per device, so the treadmill and the heart rate strap each
        need their own prompt. Wake the treadmill and put the strap on before pairing, or switch to
        simulator mode to try the flow without hardware.
      </AlertDescription>
    </Alert>
  );
}
