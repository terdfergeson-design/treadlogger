import { BrowserSupportNotice } from "@/components/browser-support-notice";
import { DashboardBlocks, type DashboardBlock } from "@/components/dashboard-blocks";
import { HeartRateCard } from "@/components/heart-rate-card";
import { HeartRateZonesPanel } from "@/components/heart-rate-zones-panel";
import { TreadmillIcon } from "@/components/icons/treadmill-icon";
import { IntervalWorkoutCard } from "@/components/interval-workout-card";
import { LiveDashboard } from "@/components/live-dashboard";
import { ModeSwitcher } from "@/components/mode-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrackProgress } from "@/components/track-progress";
import { TreadmillCard } from "@/components/treadmill-card";
import { TreadmillControls } from "@/components/treadmill-controls";
import { WorkoutChart } from "@/components/workout-chart";
import { WorkoutControls } from "@/components/workout-controls";
import { WorkoutSummary } from "@/components/workout-summary";

// Order here is only the *default* — DashboardBlocks lets the user drag each
// block (by its handle) into whatever order they want, mouse or long-press,
// and remembers it in localStorage. The two device-status/device-controls
// blocks each stay a single paired grid rather than splitting into two
// separately-orderable halves, since they're laid out side by side on
// purpose (see their own className) and would fight that layout if split.
const DASHBOARD_BLOCKS: DashboardBlock[] = [
  {
    id: "device-status",
    label: "Treadmill & Heart Rate",
    content: (
      <div className="grid gap-4 md:grid-cols-2">
        <TreadmillCard />
        <HeartRateCard />
      </div>
    ),
  },
  { id: "track", label: "Track", content: <TrackProgress /> },
  { id: "workout-chart", label: "Workout Chart", content: <WorkoutChart /> },
  { id: "live-metrics", label: "Live Metrics", content: <LiveDashboard /> },
  { id: "workout-controls", label: "Workout Controls", content: <WorkoutControls /> },
  { id: "interval-workout", label: "Interval Workout", content: <IntervalWorkoutCard /> },
  { id: "workout-summary", label: "Workout Summary", content: <WorkoutSummary /> },
  {
    id: "device-controls",
    label: "Treadmill & Heart Rate Zone Controls",
    content: (
      <div className="grid gap-4 lg:grid-cols-2">
        <TreadmillControls />
        <HeartRateZonesPanel />
      </div>
    ),
  },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl">
            <TreadmillIcon className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">TreadLogger</h1>
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

        <DashboardBlocks blocks={DASHBOARD_BLOCKS} />
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
