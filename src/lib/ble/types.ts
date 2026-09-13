import type { FeatureReport } from "./ftms/features";
import type { InclinationRange, SpeedRange } from "./ftms/ranges";
import type { MachineState } from "./ftms/status";
import {
  DEFAULT_MACHINE_SPEED_UNIT,
  fromMachineSpeed,
  type MachineSpeedUnit,
} from "./ftms/speed-units";
import type { TreadmillData } from "./ftms/treadmill-data";
import type { HeartRateMeasurement } from "./hr/measurement";
import { ObservableStore } from "./observable-store";

/**
 * Lifecycle of a single device link.
 *
 * `requesting` covers the browser's own chooser dialog, which is a distinct wait
 * from `connecting` because only the user can end it.
 */
export type ConnectionState =
  | "unsupported"
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/** Which backend a source talks to. Surfaced so the UI can label demo data. */
export type SourceKind = "bluetooth" | "simulator";

export interface TreadmillSnapshot {
  kind: SourceKind;
  connection: ConnectionState;
  deviceName?: string;
  error?: string;
  /** True once Request Control has been acknowledged by the machine. */
  hasControl: boolean;
  data: TreadmillData;
  speedRange?: SpeedRange;
  inclineRange?: InclinationRange;
  features?: FeatureReport;
  machineState: MachineState;
  /** Most recent Fitness Machine Status or control-point message. */
  lastMessage?: string;
  /** Epoch millis of the last Treadmill Data notification. */
  lastUpdateAt?: number;
}

export interface HeartRateSnapshot {
  kind: SourceKind;
  connection: ConnectionState;
  deviceName?: string;
  error?: string;
  measurement?: HeartRateMeasurement;
  bodySensorLocation?: string;
  batteryPercent?: number;
  lastUpdateAt?: number;
}

export const emptyTreadmillSnapshot = (kind: SourceKind): TreadmillSnapshot => ({
  kind,
  connection: "idle",
  hasControl: false,
  data: { flags: 0 },
  machineState: "unknown",
});

export const emptyHeartRateSnapshot = (kind: SourceKind): HeartRateSnapshot => ({
  kind,
  connection: "idle",
});

/**
 * A treadmill the app can read and drive.
 *
 * Implemented twice: over Web Bluetooth against a real FTMS machine, and by the
 * simulator. Nothing above this interface knows which one it holds.
 */
export abstract class TreadmillSource extends ObservableStore<TreadmillSnapshot> {
  /**
   * The unit this machine puts in the Treadmill Data (0x2ACD) speed fields —
   * what a runner reads off the belt.
   *
   * This is deliberately a separate setting from {@link commandSpeedUnit}
   * below. The two look like they ought to be the same machine property, and
   * on most treadmills they are, but real hardware has turned up with a
   * spec-compliant km/h Treadmill Data characteristic and a Control Point
   * (0x2AD9) that reads its Set Target Speed parameter as mph regardless —
   * different firmware paths, presumably written by different code, each
   * with their own unit assumption. Sharing one flag between them meant a
   * runner could get the readout right and still have the belt run at 1.609×
   * whatever they asked for, with no way to fix it from this app.
   */
  protected speedUnit: MachineSpeedUnit = DEFAULT_MACHINE_SPEED_UNIT;

  /**
   * The unit this machine's Control Point actually reads the Set Target
   * Speed parameter (0x2AD9) as, and by extension what its Supported Speed
   * Range (0x2AD4) and the Fitness Machine Status (0x2ADA) "target speed
   * changed" field are encoded in too, since both describe that same
   * control-point value. See {@link speedUnit} for why this is not folded
   * into that one setting.
   */
  protected commandSpeedUnit: MachineSpeedUnit = DEFAULT_MACHINE_SPEED_UNIT;

  /**
   * Declares the unit the machine's Treadmill Data notifications use. Safe to
   * call while connected: nothing derived from it needs a reconnect to
   * refresh.
   */
  setSpeedUnit(unit: MachineSpeedUnit): void {
    this.speedUnit = unit;
  }

  /**
   * Declares the unit the machine's Control Point actually reads target
   * speed as. Safe to call while connected: the speed bounds already read
   * from the machine are re-derived, so the control does not have to wait
   * for a reconnect to show the corrected range.
   */
  setCommandSpeedUnit(unit: MachineSpeedUnit): void {
    this.commandSpeedUnit = unit;
  }

  /**
   * Folds a freshly parsed Treadmill Data notification into the snapshot.
   *
   * A notification only carries the fields its flags mark present — some
   * machines vary that set from packet to packet, e.g. trimming a payload's
   * secondary fields on one tick and speed itself on the next, to stay under
   * the connection's MTU. `parseTreadmillData` already returns `undefined` for
   * anything absent, so a plain overwrite of `data` would blank out a field
   * that just did not happen to appear in this particular packet, and the
   * value would flicker between real readings and 0 as different packets
   * omit different fields. Merging instead keeps the last known value for
   * whatever this notification did not include, and a field the machine
   * genuinely reports as zero still overwrites normally, since it is present
   * (just with value 0) rather than absent.
   */
  protected mergeTreadmillData(data: TreadmillData, timestamp: number): void {
    this.patch({ data: { ...this.snapshot.data, ...data }, lastUpdateAt: timestamp });
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  /** Asks the machine for write access. Required before any other command. */
  abstract requestControl(): Promise<void>;
  abstract start(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract setTargetSpeed(speedKph: number): Promise<void>;
  abstract setTargetIncline(inclinePercent: number): Promise<void>;
}

export abstract class HeartRateSource extends ObservableStore<HeartRateSnapshot> {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
}

/**
 * Fallback bounds used until the machine reports its own, and by the simulator.
 * Chosen to match a typical folding home treadmill such as the THERUN T15:
 * 0.5-12 mph. Defined from those mph figures rather than as round km/h
 * numbers because the default command unit is mph (see
 * `DEFAULT_COMMAND_SPEED_UNIT` in `use-machine-speed-unit.ts`): a bound that
 * isn't a clean value in whatever unit it gets round-tripped through for the
 * advertised Supported Speed Range picks up floating-point drift at that
 * characteristic's 0.01 resolution, and a workout starting at exactly the
 * minimum can then land a hair outside it and be rejected as out of range.
 */
export const DEFAULT_SPEED_RANGE: SpeedRange = {
  minKph: fromMachineSpeed(0.5, "mph"),
  maxKph: fromMachineSpeed(12, "mph"),
  incrementKph: fromMachineSpeed(0.1, "mph"),
};

export const DEFAULT_INCLINE_RANGE: InclinationRange = {
  minPercent: 0,
  maxPercent: 15,
  incrementPercent: 1,
};
