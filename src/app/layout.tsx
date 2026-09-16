import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";
import { IntervalWorkoutProvider } from "@/components/interval-workout-provider";
import { WorkoutProvider } from "@/components/workout-provider";
import "./globals.css";

// globals.css maps Tailwind's font tokens onto --font-sans and --font-geist-mono.
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TreadLogger — FTMS treadmill workouts with FIT export",
  description:
    "Connect an FTMS treadmill and a Bluetooth heart rate strap from the browser, control your workout, and export it as a FIT activity file.",
  // Lets Chrome offer "Add to Home Screen" / "Install app" (the PWA install
  // path from the README), and is what a Trusted Web Activity wrapper reads
  // to fill in its own app name, icons and colors — see the "Installing as
  // an Android app" section in the README.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // Matches the app's --primary green in dark mode (src/app/globals.css),
  // since the app defaults to dark theme. Colors the browser's
  // toolbar/task-switcher chrome on Android; harmless elsewhere.
  themeColor: "#4adb72",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <WorkoutProvider>
            {/* Needs to sit inside WorkoutProvider: following a plan reads the
             *  workout's own elapsed-time timer and, in automatic mode, calls
             *  back into its setTargetSpeed/setTargetIncline. */}
            <IntervalWorkoutProvider>{children}</IntervalWorkoutProvider>
          </WorkoutProvider>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
