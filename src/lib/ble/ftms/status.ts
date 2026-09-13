import { ByteCursor } from "../byte-cursor";
import {
  DEFAULT_MACHINE_SPEED_UNIT,
  fromMachineSpeed,
  toMachineSpeed,
  type MachineSpeedUnit,
} from "./speed-units";

/**
 * Fitness Machine Status (0x2ADA).
 *
 * Notifies changes the machine made on its own — someone pressed stop on the
 * console, the safety key was pulled, or control was revoked. Without this the
 * app's idea of belt state silently drifts from reality.
 */

export const StatusOpCode = {
  reset: 0x01,
  stoppedOrPausedByUser: 0x02,
  stoppedBySafetyKey: 0x03,
  startedOrResumedByUser: 0x04,
  targetSpeedChanged: 0x05,
  targetInclineChanged: 0x06,
  targetResistanceLevelChanged: 0x07,
  targetPowerChanged: 0x08,
  targetHeartRateChanged: 0x09,
  targetedExpendedEnergyChanged: 0x0a,
  targetedNumberOfStepsChanged: 0x0b,
  targetedNumberOfStridesChanged: 0x0c,
  targetedDistanceChanged: 0x0d,
  targetedTrainingTimeChanged: 0x0e,
  spinDownStatus: 0x14,
  controlPermissionLost: 0xff,
} as const;

export type MachineState = "unknown" | "running" | "paused" | "stopped";

export interface FitnessMachineStatus {
  opCode: number;
  /** Belt state this status implies, when it implies one. */
  state?: MachineState;
  targetSpeedKph?: number;
  targetInclinePercent?: number;
  targetHeartRateBpm?: number;
  /** True when the machine revoked the control granted by Request Control. */
  controlLost?: boolean;
  /** Short description suitable for a toast or an activity log line. */
  message: string;
}

export function parseFitnessMachineStatus(
  source: DataView | ArrayBuffer | Uint8Array,
  unit: MachineSpeedUnit = DEFAULT_MACHINE_SPEED_UNIT,
): FitnessMachineStatus {
  const cursor = new ByteCursor(source);

  if (!cursor.has(1)) {
    throw new Error("Fitness Machine Status payload is empty");
  }

  const opCode = cursor.uint8();

  switch (opCode) {
    case StatusOpCode.reset:
      return { opCode, state: "stopped", message: "The treadmill was reset" };

    case StatusOpCode.stoppedOrPausedByUser: {
      // Parameter 0x01 means stop, 0x02 means pause. Treat a missing parameter
      // as a stop, the safer assumption for session bookkeeping.
      const parameter = cursor.has(1) ? cursor.uint8() : 0x01;
      const paused = parameter === 0x02;
      return {
        opCode,
        state: paused ? "paused" : "stopped",
        message: paused
          ? "Paused from the treadmill console"
          : "Stopped from the treadmill console",
      };
    }

    case StatusOpCode.stoppedBySafetyKey:
      return {
        opCode,
        state: "stopped",
        message: "Stopped — the safety key was removed",
      };

    case StatusOpCode.startedOrResumedByUser:
      return {
        opCode,
        state: "running",
        message: "Started from the treadmill console",
      };

    case StatusOpCode.targetSpeedChanged: {
      if (!cursor.has(2)) return { opCode, message: "Target speed changed" };
      const targetSpeedKph = fromMachineSpeed(cursor.uint16() / 100, unit);
      // The message is user-facing, so it is reported in mph regardless of the
      // machine's own unit, which only matters for the GATT conversion above.
      return {
        opCode,
        targetSpeedKph,
        message: `Target speed changed to ${toMachineSpeed(targetSpeedKph, "mph").toFixed(1)} mph`,
      };
    }

    case StatusOpCode.targetInclineChanged: {
      if (!cursor.has(2)) return { opCode, message: "Target incline changed" };
      const targetInclinePercent = cursor.int16() / 10;
      return {
        opCode,
        targetInclinePercent,
        message: `Target incline changed to ${targetInclinePercent.toFixed(1)}%`,
      };
    }

    case StatusOpCode.targetHeartRateChanged: {
      if (!cursor.has(1)) return { opCode, message: "Target heart rate changed" };
      const targetHeartRateBpm = cursor.uint8();
      return {
        opCode,
        targetHeartRateBpm,
        message: `Target heart rate changed to ${targetHeartRateBpm} bpm`,
      };
    }

    case StatusOpCode.controlPermissionLost:
      return {
        opCode,
        controlLost: true,
        message: "The treadmill revoked app control",
      };

    default:
      return {
        opCode,
        message: `Treadmill status 0x${opCode.toString(16).padStart(2, "0")}`,
      };
  }
}
