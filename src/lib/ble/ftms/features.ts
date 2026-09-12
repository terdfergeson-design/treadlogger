import { ByteCursor } from "../byte-cursor";

/**
 * Fitness Machine Feature (0x2ACC): two 32-bit bitfields describing what the
 * machine measures and what it lets a client set.
 *
 * The app reads this to decide whether to offer incline control at all, rather
 * than showing a slider that the treadmill will reject.
 */

export interface FitnessMachineFeatures {
  averageSpeed: boolean;
  cadence: boolean;
  totalDistance: boolean;
  inclination: boolean;
  elevationGain: boolean;
  pace: boolean;
  stepCount: boolean;
  resistanceLevel: boolean;
  strideCount: boolean;
  expendedEnergy: boolean;
  heartRateMeasurement: boolean;
  metabolicEquivalent: boolean;
  elapsedTime: boolean;
  remainingTime: boolean;
  powerMeasurement: boolean;
  forceOnBeltAndPowerOutput: boolean;
  userDataRetention: boolean;
}

export interface TargetSettingFeatures {
  speed: boolean;
  inclination: boolean;
  resistance: boolean;
  power: boolean;
  heartRate: boolean;
  expendedEnergy: boolean;
  stepNumber: boolean;
  strideNumber: boolean;
  distance: boolean;
  trainingTime: boolean;
  timeInTwoHeartRateZones: boolean;
  timeInThreeHeartRateZones: boolean;
  timeInFiveHeartRateZones: boolean;
  indoorBikeSimulation: boolean;
  wheelCircumference: boolean;
  spinDownControl: boolean;
  targetedCadence: boolean;
}

export interface FeatureReport {
  machine: FitnessMachineFeatures;
  targets: TargetSettingFeatures;
  rawMachineFlags: number;
  rawTargetFlags: number;
}

const bit = (flags: number, position: number) => (flags & (1 << position)) !== 0;

export function parseFitnessMachineFeature(
  source: DataView | ArrayBuffer | Uint8Array,
): FeatureReport {
  const cursor = new ByteCursor(source);

  if (!cursor.has(8)) {
    throw new Error("Fitness Machine Feature must be 8 bytes");
  }

  const machineFlags = cursor.uint32();
  const targetFlags = cursor.uint32();

  return {
    rawMachineFlags: machineFlags,
    rawTargetFlags: targetFlags,
    machine: {
      averageSpeed: bit(machineFlags, 0),
      cadence: bit(machineFlags, 1),
      totalDistance: bit(machineFlags, 2),
      inclination: bit(machineFlags, 3),
      elevationGain: bit(machineFlags, 4),
      pace: bit(machineFlags, 5),
      stepCount: bit(machineFlags, 6),
      resistanceLevel: bit(machineFlags, 7),
      strideCount: bit(machineFlags, 8),
      expendedEnergy: bit(machineFlags, 9),
      heartRateMeasurement: bit(machineFlags, 10),
      metabolicEquivalent: bit(machineFlags, 11),
      elapsedTime: bit(machineFlags, 12),
      remainingTime: bit(machineFlags, 13),
      powerMeasurement: bit(machineFlags, 14),
      forceOnBeltAndPowerOutput: bit(machineFlags, 15),
      userDataRetention: bit(machineFlags, 16),
    },
    targets: {
      speed: bit(targetFlags, 0),
      inclination: bit(targetFlags, 1),
      resistance: bit(targetFlags, 2),
      power: bit(targetFlags, 3),
      heartRate: bit(targetFlags, 4),
      expendedEnergy: bit(targetFlags, 5),
      stepNumber: bit(targetFlags, 6),
      strideNumber: bit(targetFlags, 7),
      distance: bit(targetFlags, 8),
      trainingTime: bit(targetFlags, 9),
      timeInTwoHeartRateZones: bit(targetFlags, 10),
      timeInThreeHeartRateZones: bit(targetFlags, 11),
      timeInFiveHeartRateZones: bit(targetFlags, 12),
      indoorBikeSimulation: bit(targetFlags, 13),
      wheelCircumference: bit(targetFlags, 14),
      spinDownControl: bit(targetFlags, 15),
      targetedCadence: bit(targetFlags, 16),
    },
  };
}
