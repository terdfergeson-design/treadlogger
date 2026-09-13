"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import {
  DEFAULT_INCLINE_RANGE,
  DEFAULT_SPEED_RANGE,
  type HeartRateSnapshot,
  type HeartRateSource,
  type TreadmillSnapshot,
  type TreadmillSource,
} from "@/lib/ble/types";
import { fromMachineSpeed, type MachineSpeedUnit } from "@/lib/ble/ftms/speed-units";
import { WebBluetoothTreadmill } from "@/lib/ble/web-bluetooth-treadmill";
import { WebBluetoothHeartRate } from "@/lib/ble/web-bluetooth-heart-rate";
import { useBluetoothSupport } from "@/hooks/use-bluetooth-support";
import { useCommandSpeedUnit, useMachineSpeedUnit } from "@/hooks/use-machine-speed-unit";
import { createSimulator } from "@/lib/mock/simulator";
import { DEFAULT_RUNNER_PROFILE } from "@/lib/mock/physiology";
import {
  encodeFitActivity,
  fitActivityInputFromWorkout,
  fitFileName,
} from "@/lib/fit/encode-activity";
import { downloadBytes } from "@/lib/fit/download";
import { verifyFitBytes, type FitVerification } from "@/lib/fit/verify";
import { WorkoutRecorder, type WorkoutSnapshot } from "@/lib/workout/session";

/**
 * Wires the device sources, the recorder and the FIT export together, and is the
 * only place that knows whether the app is talking to real hardware or to the
 * simulator.
 */

export type DeviceMode = "bluetooth" | "simulator";

/** How often the recorder folds a device reading into the session. */
const SAMPLE_INTERVAL_MS = 1_000;

/**
 * This treadmill always begins a workout at 0.5 mph, no matter what target
 * speed was requested beforehand — ramping up is left entirely to the runner
 * once the belt is already moving. So the pre-start target is not really a
 * choice the runner makes; it is fixed at what the machine actually does, and
 * the control that lets you change it stays locked until the workout is
 * underway (see the speed `ControlRow` in `treadmill-controls.tsx`).
 */
const STARTING_SPEED_KPH = fromMachineSpeed(0.5, "mph");

export interface EncodedActivity {
  bytes: Uint8Array;
  fileName: string;
  verification: FitVerification;
}

interface WorkoutContextValue {
  mode: DeviceMode;
  setMode: (mode: DeviceMode) => void;

  treadmill: TreadmillSnapshot;
  heartRate: HeartRateSnapshot;
  workout: WorkoutSnapshot;

  /** Null until the browser has been probed after mount. */
  bluetoothSupported: boolean | null;
  secureContext: boolean;

  connectTreadmill: () => Promise<void>;
  disconnectTreadmill: () => Promise<void>;
  connectHeartRate: () => Promise<void>;
  disconnectHeartRate: () => Promise<void>;

  targetSpeedKph: number;
  targetInclinePercent: number;
  setTargetSpeed: (speedKph: number) => Promise<void>;
  setTargetIncline: (inclinePercent: number) => Promise<void>;
  speedRange: typeof DEFAULT_SPEED_RANGE;
  inclineRange: typeof DEFAULT_INCLINE_RANGE;

  /** The unit the connected treadmill's Treadmill Data readout uses. */
  machineSpeedUnit: MachineSpeedUnit;
  setMachineSpeedUnit: (unit: MachineSpeedUnit) => void;

  /**
   * The unit the connected treadmill's Control Point actually reads target
   * speed as. Independent of `machineSpeedUnit` — some real machines report a
   * spec-compliant km/h readout while their Control Point reads mph
   * regardless, so one toggle cannot describe both.
   */
  commandSpeedUnit: MachineSpeedUnit;
  setCommandSpeedUnit: (unit: MachineSpeedUnit) => void;

  maxHeartRateBpm: number;
  setMaxHeartRateBpm: (bpm: number) => void;

  startWorkout: () => Promise<void>;
  pauseWorkout: () => Promise<void>;
  resumeWorkout: () => Promise<void>;
  finishWorkout: () => Promise<void>;
  discardWorkout: () => void;

  encodedActivity: EncodedActivity | null;
  downloadActivity: () => void;
  busy: boolean;
}

const WorkoutContext = createContext<WorkoutContextValue | null>(null);

interface Sources {
  treadmill: TreadmillSource;
  heartRate: HeartRateSource;
}

function createSources(mode: DeviceMode): Sources {
  if (mode === "simulator") {
    const { treadmill, heartRate } = createSimulator();
    return { treadmill, heartRate };
  }

  return { treadmill: new WebBluetoothTreadmill(), heartRate: new WebBluetoothHeartRate() };
}

export function WorkoutProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<DeviceMode>("bluetooth");
  const [sources, setSources] = useState<Sources>(() => createSources("bluetooth"));
  const [maxHeartRateBpm, setMaxHeartRateBpm] = useState(DEFAULT_RUNNER_PROFILE.maxHeartRateBpm);
  const [machineSpeedUnit, setMachineSpeedUnit] = useMachineSpeedUnit();
  const [commandSpeedUnit, setCommandSpeedUnit] = useCommandSpeedUnit();
  const [requestedSpeedKph, setRequestedSpeedKph] = useState(STARTING_SPEED_KPH);
  const [requestedInclinePercent, setRequestedInclinePercent] = useState(0);
  const [encodedActivity, setEncodedActivity] = useState<EncodedActivity | null>(null);
  const [busy, setBusy] = useState(false);

  const { supported: bluetoothSupported, secureContext } = useBluetoothSupport();

  const [recorder] = useState(
    () => new WorkoutRecorder({ maxHeartRateBpm, sampleIntervalMs: SAMPLE_INTERVAL_MS }),
  );

  const treadmill = useSyncExternalStore(
    sources.treadmill.subscribe,
    sources.treadmill.getSnapshot,
    sources.treadmill.getSnapshot,
  );
  const heartRate = useSyncExternalStore(
    sources.heartRate.subscribe,
    sources.heartRate.getSnapshot,
    sources.heartRate.getSnapshot,
  );
  const workout = useSyncExternalStore(
    recorder.subscribe,
    recorder.getSnapshot,
    recorder.getSnapshot,
  );

  useEffect(() => {
    recorder.setMaxHeartRate(maxHeartRateBpm);
  }, [recorder, maxHeartRateBpm]);

  // Both units belong to the machine, so each is pushed to whichever source
  // is live, including one a mode switch has just created.
  useEffect(() => {
    sources.treadmill.setSpeedUnit(machineSpeedUnit);
  }, [sources.treadmill, machineSpeedUnit]);

  useEffect(() => {
    sources.treadmill.setCommandSpeedUnit(commandSpeedUnit);
  }, [sources.treadmill, commandSpeedUnit]);

  // Sampling reads each source's live snapshot rather than the values captured by
  // this render, so a tick can never fold a stale reading into the session. The
  // interval is only rebuilt when the workout starts or stops, or when a mode
  // switch replaces the sources.
  useEffect(() => {
    if (workout.state !== "active") return;

    const timer = setInterval(() => {
      recorder.tick({
        treadmill: sources.treadmill.snapshot.data,
        heartRate: sources.heartRate.snapshot.measurement,
      });
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [workout.state, recorder, sources]);

  // Adopt the machine's own limits once it reports them. The requested targets
  // are clamped on the way out rather than rewritten in state, so connecting a
  // treadmill with a narrower range cannot leave a stale out-of-range value
  // behind.
  const speedRange = treadmill.speedRange ?? DEFAULT_SPEED_RANGE;
  const inclineRange = treadmill.inclineRange ?? DEFAULT_INCLINE_RANGE;

  const targetSpeedKph = clamp(requestedSpeedKph, speedRange.minKph, speedRange.maxKph);
  const targetInclinePercent = clamp(
    requestedInclinePercent,
    inclineRange.minPercent,
    inclineRange.maxPercent,
  );

  // A treadmill that stops itself, or a runner who hits stop on the console,
  // should pause the recording rather than leave it banking time.
  useEffect(() => {
    if (workout.state !== "active") return;
    if (treadmill.machineState !== "stopped" && treadmill.machineState !== "paused") return;

    recorder.pause();
    toast.warning("Workout paused", {
      description: treadmill.lastMessage ?? "The treadmill stopped.",
    });
  }, [treadmill.machineState, treadmill.lastMessage, workout.state, recorder]);

  const setMode = useCallback(
    (next: DeviceMode) => {
      if (next === mode) return;

      const previous = sources;
      void previous.treadmill.disconnect();
      void previous.heartRate.disconnect();

      recorder.reset();
      setEncodedActivity(null);
      setModeState(next);
      setSources(createSources(next));
    },
    [mode, sources, recorder],
  );

  /** Runs a device action, reporting failures as a toast instead of throwing. */
  const guard = useCallback(
    async (action: () => Promise<void>, failureTitle: string): Promise<boolean> => {
      setBusy(true);
      try {
        await action();
        return true;
      } catch (error) {
        // A cancelled chooser is the user changing their mind, not a failure.
        if (error instanceof Error && error.name === "NotFoundError") return false;
        toast.error(failureTitle, {
          description: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const connectTreadmill = useCallback(async () => {
    const connected = await guard(
      () => sources.treadmill.connect(),
      "Could not connect to the treadmill",
    );
    if (connected) toast.success("Treadmill connected");
  }, [guard, sources.treadmill]);

  const connectHeartRate = useCallback(async () => {
    const connected = await guard(
      () => sources.heartRate.connect(),
      "Could not connect to the heart rate monitor",
    );
    if (connected) toast.success("Heart rate monitor connected");
  }, [guard, sources.heartRate]);

  const disconnectTreadmill = useCallback(async () => {
    await sources.treadmill.disconnect();
  }, [sources.treadmill]);

  const disconnectHeartRate = useCallback(async () => {
    await sources.heartRate.disconnect();
  }, [sources.heartRate]);

  const setTargetSpeed = useCallback(
    async (speedKph: number) => {
      const clamped = clamp(speedKph, speedRange.minKph, speedRange.maxKph);
      setRequestedSpeedKph(clamped);

      if (treadmill.connection !== "connected") return;
      await guard(() => sources.treadmill.setTargetSpeed(clamped), "Could not set the speed");
    },
    [guard, sources.treadmill, speedRange.maxKph, speedRange.minKph, treadmill.connection],
  );

  const setTargetIncline = useCallback(
    async (inclinePercent: number) => {
      const clamped = clamp(inclinePercent, inclineRange.minPercent, inclineRange.maxPercent);
      setRequestedInclinePercent(clamped);

      if (treadmill.connection !== "connected") return;
      await guard(
        () => sources.treadmill.setTargetIncline(clamped),
        "Could not set the incline",
      );
    },
    [
      guard,
      sources.treadmill,
      inclineRange.maxPercent,
      inclineRange.minPercent,
      treadmill.connection,
    ],
  );

  const startWorkout = useCallback(async () => {
    setEncodedActivity(null);

    if (treadmill.connection === "connected") {
      const started = await guard(async () => {
        await sources.treadmill.setTargetSpeed(targetSpeedKph);
        await sources.treadmill.start();
      }, "The treadmill would not start");

      // Recording a workout the belt never began would produce a file full of
      // zeroes, so the recorder only starts once the machine has agreed.
      if (!started) return;
    }

    recorder.start();
    toast.success("Workout started");
  }, [guard, recorder, sources.treadmill, targetSpeedKph, treadmill.connection]);

  const pauseWorkout = useCallback(async () => {
    if (treadmill.connection === "connected") {
      await guard(() => sources.treadmill.pause(), "The treadmill would not pause");
    }
    recorder.pause();
  }, [guard, recorder, sources.treadmill, treadmill.connection]);

  const resumeWorkout = useCallback(async () => {
    if (treadmill.connection === "connected") {
      const resumed = await guard(
        () => sources.treadmill.start(),
        "The treadmill would not resume",
      );
      if (!resumed) return;
    }
    recorder.resume();
  }, [guard, recorder, sources.treadmill, treadmill.connection]);

  const finishWorkout = useCallback(async () => {
    if (treadmill.connection === "connected") {
      await guard(() => sources.treadmill.stop(), "The treadmill would not stop");
    }

    recorder.finish();
    // The next workout begins at 0.5 mph regardless, so the pre-start slider
    // should already show that rather than wherever this one ended.
    setRequestedSpeedKph(STARTING_SPEED_KPH);

    const snapshot = recorder.snapshot;
    if (snapshot.startedAt === undefined) return;

    // Encode straight away and decode the result, so the summary can state that
    // the file is valid before the runner clicks download.
    try {
      const bytes = encodeFitActivity(
        fitActivityInputFromWorkout(snapshot, {
          treadmillName: sources.treadmill.snapshot.deviceName,
          heartRateMonitorName: sources.heartRate.snapshot.deviceName,
          simulated: mode === "simulator",
        }),
      );

      setEncodedActivity({
        bytes,
        fileName: fitFileName(new Date(snapshot.startedAt), mode === "simulator"),
        verification: verifyFitBytes(bytes),
      });
      toast.success("Workout complete", { description: "Your FIT file is ready to download." });
    } catch (error) {
      toast.error("Could not build the FIT file", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [guard, mode, recorder, sources.heartRate, sources.treadmill, treadmill.connection]);

  const discardWorkout = useCallback(() => {
    recorder.reset();
    setEncodedActivity(null);
    setRequestedSpeedKph(STARTING_SPEED_KPH);
  }, [recorder]);

  const downloadActivity = useCallback(() => {
    if (!encodedActivity) return;
    downloadBytes(encodedActivity.bytes, encodedActivity.fileName);
    toast.success("FIT file saved", { description: encodedActivity.fileName });
  }, [encodedActivity]);

  const value = useMemo<WorkoutContextValue>(
    () => ({
      mode,
      setMode,
      treadmill,
      heartRate,
      workout,
      bluetoothSupported,
      secureContext,
      connectTreadmill,
      disconnectTreadmill,
      connectHeartRate,
      disconnectHeartRate,
      targetSpeedKph,
      targetInclinePercent,
      setTargetSpeed,
      setTargetIncline,
      speedRange,
      inclineRange,
      machineSpeedUnit,
      setMachineSpeedUnit,
      commandSpeedUnit,
      setCommandSpeedUnit,
      maxHeartRateBpm,
      setMaxHeartRateBpm,
      startWorkout,
      pauseWorkout,
      resumeWorkout,
      finishWorkout,
      discardWorkout,
      encodedActivity,
      downloadActivity,
      busy,
    }),
    [
      mode,
      setMode,
      treadmill,
      heartRate,
      workout,
      bluetoothSupported,
      secureContext,
      connectTreadmill,
      disconnectTreadmill,
      connectHeartRate,
      disconnectHeartRate,
      targetSpeedKph,
      targetInclinePercent,
      setTargetSpeed,
      setTargetIncline,
      speedRange,
      inclineRange,
      machineSpeedUnit,
      setMachineSpeedUnit,
      commandSpeedUnit,
      setCommandSpeedUnit,
      maxHeartRateBpm,
      startWorkout,
      pauseWorkout,
      resumeWorkout,
      finishWorkout,
      discardWorkout,
      encodedActivity,
      downloadActivity,
      busy,
    ],
  );

  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>;
}

export function useWorkout(): WorkoutContextValue {
  const value = useContext(WorkoutContext);
  if (!value) throw new Error("useWorkout must be used inside a WorkoutProvider");
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
