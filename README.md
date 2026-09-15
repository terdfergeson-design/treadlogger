# TreadLogger

Track and control a Bluetooth treadmill workout from the browser, log heart rate from a chest
strap, and export the result as a FIT activity file.

TreadLogger talks directly to two standard Bluetooth Low Energy services over Web Bluetooth:

- **Fitness Machine Service** (`0x1826`) on an FTMS treadmill — reads speed, distance, incline,
  pace, elapsed time and calories, and drives the belt through the Fitness Machine Control Point.
  Developed against a THERUN T15, but nothing in the code is specific to that model; any treadmill
  that implements FTMS should work.
- **Heart Rate Service** (`0x180D`) on a chest strap — live BPM, sensor contact and RR intervals.

There is no account, no database and no server. Everything, including the FIT encoding, happens in
the page.

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:43117>.

A **simulator mode** is built in, so you can exercise the whole flow — connect, run, pause, finish,
export — without owning a treadmill. See [Simulator mode](#simulator-mode).

## Browser requirements

Web Bluetooth is required, which means:

| Requirement | Detail |
| --- | --- |
| Browser | Chrome, Edge, Opera or another Chromium browser, on desktop or Android |
| Not supported | Safari and Firefox do not implement Web Bluetooth; it is unavailable on iOS |
| Secure context | The page must be served over `https`, or from `localhost` |

`localhost` counts as a secure context, so `npm run dev` works without certificates. A plain-HTTP
LAN address such as `http://192.168.1.20:43117` does **not** — to run a workout from a phone or a
tablet on your network, put the app behind https (a tunnel such as `cloudflared` or `ngrok` is the
easiest way).

The app detects both problems and explains them in place, offering simulator mode as a way through.

### Chrome flags as a workaround

Two `chrome://flags` entries can stand in for the requirements above when you just need to test on
a phone, without deploying or tunneling anything:

- **Experimental Web Platform features**
  (`chrome://flags/#enable-experimental-web-platform-features`) — enable it and relaunch the
  browser if `navigator.bluetooth` isn't available at all, which some Chromium builds require even
  on an otherwise-supported browser.
- **Insecure origins treated as secure**
  (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`) — enable it, add the LAN address
  you're testing from (e.g. `http://192.168.1.20:43117`), and relaunch. This treats that one
  plain-HTTP origin as a secure context, so Bluetooth works over LAN without https or a tunnel.

Both are per-device, per-browser settings meant for development — not something a normal visitor
to a deployed instance of the app would ever need to touch.

## Installing as an Android app

Because there's no build step that differs from the browser version, "the Android app" is this same
site, installed two different ways depending on how official you want it to feel.

**Add to Home Screen (PWA install).** The deployed site (`public/manifest.webmanifest`, linked from
`src/app/layout.tsx`) is an installable PWA — open it in Chrome on Android and use **Install app** /
**Add to Home Screen**. It then launches full-screen with its own icon and app-switcher entry. This
is still literally Chrome under the hood, so Web Bluetooth keeps working exactly as it does in a
normal tab — nothing about the BLE or FIT code changes for this path.

**Trusted Web Activity (Play Store package).** For a real installable `.apk`/`.aab`, wrap the
deployed PWA as a TWA with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). A TWA still
renders through the device's installed Chrome (not a stripped-down WebView), so this is packaging,
not porting — none of `src/lib/ble` changes either. Once the manifest above is live on the deployed
site:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://treadlogger-sooty.vercel.app/manifest.webmanifest
bubblewrap build
```

`init` downloads a JDK and the Android SDK on first run (it asks first) and scaffolds a
`twa-manifest.json` from the live manifest — name, icons and theme color all come from what's
already in `public/`. `build` produces both a debug-signed `.apk` (sideload it straight to a phone
with `adb install app-release-signed.apk` to test) and a `.aab` for the Play Store, plus an upload
keystore under `./android.keystore` — back that up; losing it means losing the ability to publish
updates to the same Play Store listing.

The one extra step a TWA needs that a plain PWA doesn't: a **Digital Asset Links** file at
`public/.well-known/assetlinks.json`, proving this domain owns the Android package. `bubblewrap
build` prints the exact JSON to paste in, keyed off the keystore's SHA-256 fingerprint (re-run
`bubblewrap fingerprint` any time to see it again). It has to be live on the deployed site — Chrome
checks `https://treadlogger-sooty.vercel.app/.well-known/assetlinks.json` before it'll drop the
address bar — so add it, commit, and let Vercel redeploy before testing the installed app.

## Pairing your devices

The browser asks for permission once per device, so the treadmill and the strap each need their own
prompt. There is no way to skip this — it is a deliberate part of the Web Bluetooth security model.

**Treadmill**

1. Power on the treadmill and leave it at its idle screen. Do not pair it to a phone app at the
   same time; most treadmills only accept one BLE connection.
2. Click **Pair treadmill** and pick your machine from the browser's device chooser. Only devices
   advertising the Fitness Machine Service are listed.
3. TreadLogger immediately sends **Request Control**, which is what lets it start the belt and set
   speed and incline. The card shows *Control granted* once the treadmill agrees. Treadmills can
   refuse or later revoke control — for example when someone touches the console — and the app
   reports that rather than silently failing.
4. It also reads the machine's **Supported Speed Range** and **Supported Inclination Range**, and
   uses them as the bounds and step size of the belt-control sliders.

**Heart rate strap**

1. Wet the electrodes and put the strap on. A dry strap either will not advertise or will report no
   skin contact.
2. Make sure it is not already connected to a watch or phone.
3. Click **Pair heart rate monitor** and choose it from the list.

If a device drops out mid-workout, the app says so and keeps the recording intact; reconnecting
resumes logging.

## Running a workout

**Start** begins recording and, if a treadmill is connected, starts the belt at the target speed.
The dashboard then shows time, distance, speed, pace, heart rate, incline, calories and elevation
gain, plus running averages and maxima, updating live. A sample is logged every second, and those
samples become the `record` messages in the FIT file.

**Pause** stops the belt and freezes the timer. Paused time is excluded from moving time, and the
belt's distance counter is re-baselined on resume, so a pause never inflates your totals. Stopping
from the treadmill's own console pauses the recording too, via the Fitness Machine Status
characteristic.

**Finish** stops the belt, closes the session and encodes the FIT file straight away.

Heart-rate zones are percentages of your maximum heart rate, which you can set under **Zone
settings**. Zones only affect the on-screen breakdown; raw per-second samples go into the FIT file
either way.

## FIT export

Finishing a workout encodes a FIT activity file in the browser using
[Garmin's official FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk). The file
contains the message sequence importers expect:

`file_id` → `file_creator` → `device_info` → timer start `event` → `record` per second →
timer stop `event` → `lap` → `session` → `activity`

Each `record` carries a timestamp, distance, speed, heart rate and grade (the treadmill's incline).
The session and lap carry the totals: moving time, elapsed time, distance, calories, ascent,
average and maximum speed, and average, maximum and minimum heart rate, tagged as
`running` / `treadmill`.

Before offering the download, the app decodes its own output again and reports the result — that
check validates the file header, both CRCs and every message definition, which is the same gate an
importer applies. The summary card shows the verification result and the message counts.

Files are named `treadlogger-YYYY-MM-DD-HHMMSS.fit` and can be imported into Garmin Connect, Strava,
intervals.icu or anything else that reads FIT activities. Simulated workouts get a `-simulated`
suffix and are labelled as such inside the file, so they cannot be mistaken for a real run.

## Simulator mode

Switch to **Simulator** in the header to replace both devices with a simulated treadmill and chest
strap. It exists so the full flow can be developed and demonstrated without hardware.

It is more than a stub. The simulator models belt and incline actuators that ramp at realistic
rates, integrates distance, and derives calories and heart rate from the ACSM metabolic equations
for graded walking and running, with heart rate following its steady-state target through a
first-order lag. Set the incline to 8% and the simulated heart rate climbs, then recovers when you
ease off.

It also builds the same GATT byte payloads a real peripheral would send and feeds them back through
the production parsers, rather than shortcutting to parsed objects. Mock mode therefore exercises
the real flag handling, field ordering and unit conversions.

Switching modes disconnects both devices and clears any recording, so simulated and real data can
never mix.

## Project layout

```
src/
  app/                        Next.js app router entry, layout and page
  components/                 UI, with workout-provider.tsx wiring devices to the recorder
  hooks/                      Small React helpers
  lib/
    ble/
      byte-cursor.ts          Little-endian reader for GATT payloads
      byte-writer.ts          Little-endian writer
      ftms/                   Fitness Machine Service
        treadmill-data.ts       Treadmill Data (0x2ACD) flag-driven parser
        control-point.ts        Control Point (0x2AD9) commands and responses
        ranges.ts               Supported Speed (0x2AD4) / Inclination (0x2AD5) ranges
        status.ts               Fitness Machine Status (0x2ADA)
        features.ts             Fitness Machine Feature (0x2ACC)
      hr/measurement.ts       Heart Rate Measurement (0x2A37)
      types.ts                TreadmillSource / HeartRateSource interfaces
      web-bluetooth-*.ts      Real GATT clients
    mock/                     Simulator: payload builders, physiology, simulated devices
    workout/                  Session recorder and heart-rate zones
    fit/                      FIT activity encoder, verification and download
```

The two device backends sit behind the `TreadmillSource` and `HeartRateSource` interfaces in
`src/lib/ble/types.ts`. Nothing above that layer knows whether it is driving hardware or the
simulator.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 43117 |
| `npm run build` | Production build |
| `npm start` | Serve the production build on port 43117 |
| `npm test` | Unit tests |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Tests

```bash
npm test
```

The parser tests use byte payloads written out by hand from the FTMS and Heart Rate
specifications, rather than generated by this project's own encoder, so they check the parsers
against the specs instead of against a mirror of themselves. They cover the inverted "more data"
flag that governs whether instantaneous speed is present, signed inclines, 24-bit distance,
unavailable-value sentinels, truncated payloads, and both the 8-bit and 16-bit heart rate encodings.

The FIT tests encode an activity and decode it again with the SDK's decoder, asserting the framing,
the CRCs and every field value within FIT's stored resolution.

The recorder tests cover the awkward parts of session bookkeeping: treadmill counters that do not
start at zero, counters that reset mid-workout, and belt movement during a pause.

## Notes and limits

- Only one BLE central can hold a treadmill at a time. Close the manufacturer's phone app first.
- FTMS defines every speed field as km/h, but some machines put mph in them and say nothing, so the
  belt runs a factor of 1.609 fast and its reported speed reads a factor of 1.609 slow. If the belt
  runs faster than the speed you set, switch **Treadmill speed unit** to mph under Belt control. The
  choice is remembered, and it is applied to the commanded target, the reported speed and the
  machine's advertised speed range together, so the number you set and the number you get agree.
- Treadmills vary in which FTMS fields they report. The parser handles any subset, and the app
  falls back to integrating speed when a machine does not report distance.
- The FTMS specification labels its pace fields "kilometre per minute", but a `uint8` at 0.1
  resolution only covers a usable range read as minutes per kilometre, which is what treadmills
  send in practice. Both the raw byte and that interpretation are exposed; the dashboard derives
  pace from speed instead, which is higher resolution and always present.
- The file is written with FIT manufacturer id 255 (`development`), the id reserved for software
  without a registered Garmin manufacturer id.
