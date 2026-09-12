import type { FeatureReport } from "./ftms/features";
import type { InclinationRange, SpeedRange } from "./ftms/ranges";
import type { MachineState } from "./ftms/status";
import { DEFAULT_MACHINE_SPEED_UNIT, type MachineSpeedUnit } from "./ftms/speed-units";
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
  /** The unit this machine puts in the FTMS speed fields. */
  protected speedUnit: MachineSpeedUnit = DEFAULT_MACHINE_SPEED_UNIT;

  /**
   * Declares the machine's speed unit. Safe to call while connected: the
   * bounds already read from the machine are re-derived, so the control does
   * not have to wait for a reconnect to show the corrected range.
   */
  setSpeedUnit(unit: MachineSpeedUnit): void {
    this.speedUnit = unit;
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
 * Chosen to match a typical folding home treadmill such as the THERUN T15.
 */
export const DEFAULT_SPEED_RANGE: SpeedRange = {
  minKph: 1,
  maxKph: 16,
  incrementKph: 0.1,
};

export const DEFAULT_INCLINE_RANGE: InclinationRange = {
  minPercent: 0,
  maxPercent: 15,
  incrementPercent: 1,
};
