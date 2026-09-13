import { Footprints } from "lucide-react";

import { BrowserSupportNotice } from "@/components/browser-support-notice";
import { HeartRateCard } from "@/components/heart-rate-card";
import { HeartRateZonesPanel } from "@/components/heart-rate-zones-panel";
import { LiveDashboard } from "@/components/live-dashboard";
import { ModeSwitcher } from "@/components/mode-switcher";
import { RunnerSettings } from "@/components/runner-settings";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrackProgress } from "@/components/track-progress";
import { TreadmillCard } from "@/components/treadmill-card";
import { TreadmillControls } from "@/components/treadmill-controls";
import { WorkoutControls } from "@/components/workout-controls";
import { WorkoutSummary } from "@/components/workout-summary";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl">
            <Footprints className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Treadlink</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Treadmill workouts over Web Bluetooth, exported as FIT
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ModeSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="space-y-4">
        <BrowserSupportNotice />

        <div className="grid gap-4 md:grid-cols-2">
          <TreadmillCard />
          <HeartRateCard />
        </div>

        <TrackProgress />

        <LiveDashboard />
        <WorkoutControls />
        <WorkoutSummary />

        <div className="grid gap-4 lg:grid-cols-2">
          <TreadmillControls />
          <div className="space-y-4">
            <HeartRateZonesPanel />
            <RunnerSettings />
          </div>
        </div>
      </div>

      <footer className="text-muted-foreground mt-10 border-t pt-4 text-xs">
        <p>
          Speaks the Bluetooth SIG Fitness Machine Service (0x1826) and Heart Rate Service (0x180D).
          Everything runs in your browser — no account, no server, no data leaves the device.
        </p>
      </footer>
    </div>
  );
}
