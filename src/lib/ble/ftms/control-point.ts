import { ByteCursor } from "../byte-cursor";

/**
 * Fitness Machine Control Point (0x2AD9).
 *
 * Writes are acknowledged out-of-band: the machine indicates back on the same
 * characteristic with an 0x80 response naming the op code it is answering. A
 * treadmill rejects everything until Request Control (0x00) succeeds, and it can
 * revoke control later via the Fitness Machine Status characteristic.
 */

export const ControlOpCode = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetSpeed: 0x02,
  setTargetInclination: 0x03,
  setTargetResistanceLevel: 0x04,
  setTargetPower: 0x05,
  setTargetHeartRate: 0x06,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setTargetedExpendedEnergy: 0x09,
  setTargetedNumberOfSteps: 0x0a,
  setTargetedNumberOfStrides: 0x0b,
  setTargetedDistance: 0x0c,
  setTargetedTrainingTime: 0x0d,
  responseCode: 0x80,
} as const;

export type ControlOpCodeValue = (typeof ControlOpCode)[keyof typeof ControlOpCode];

/** Parameter for Stop or Pause (0x08). The two states are distinct on FTMS. */
export const StopOrPauseParameter = {
  stop: 0x01,
  pause: 0x02,
} as const;

export const ControlResultCode = {
  success: 0x01,
  opCodeNotSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const;

export type ControlResultCodeValue = (typeof ControlResultCode)[keyof typeof ControlResultCode];

const OP_CODE_LABELS: Record<number, string> = {
  [ControlOpCode.requestControl]: "Request control",
  [ControlOpCode.reset]: "Reset",
  [ControlOpCode.setTargetSpeed]: "Set target speed",
  [ControlOpCode.setTargetInclination]: "Set target incline",
  [ControlOpCode.setTargetResistanceLevel]: "Set target resistance",
  [ControlOpCode.setTargetPower]: "Set target power",
  [ControlOpCode.setTargetHeartRate]: "Set target heart rate",
  [ControlOpCode.startOrResume]: "Start or resume",
  [ControlOpCode.stopOrPause]: "Stop or pause",
  [ControlOpCode.setTargetedExpendedEnergy]: "Set target energy",
  [ControlOpCode.setTargetedNumberOfSteps]: "Set target steps",
  [ControlOpCode.setTargetedNumberOfStrides]: "Set target strides",
  [ControlOpCode.setTargetedDistance]: "Set target distance",
  [ControlOpCode.setTargetedTrainingTime]: "Set target time",
};

const RESULT_MESSAGES: Record<number, string> = {
  [ControlResultCode.success]: "Success",
  [ControlResultCode.opCodeNotSupported]: "The treadmill does not support this command",
  [ControlResultCode.invalidParameter]: "The treadmill rejected the value as out of range",
  [ControlResultCode.operationFailed]: "The treadmill could not complete the command",
  [ControlResultCode.controlNotPermitted]:
    "The treadmill has not granted control — request control first",
};

export function describeOpCode(opCode: number): string {
  return OP_CODE_LABELS[opCode] ?? `Op code 0x${opCode.toString(16).padStart(2, "0")}`;
}

export function describeResultCode(resultCode: number): string {
  return (
    RESULT_MESSAGES[resultCode] ??
    `Unknown result code 0x${resultCode.toString(16).padStart(2, "0")}`
  );
}

/** Takes control of the machine. Every other write fails until this succeeds. */
export function requestControl(): Uint8Array {
  return Uint8Array.of(ControlOpCode.requestControl);
}

export function reset(): Uint8Array {
  return Uint8Array.of(ControlOpCode.reset);
}

export function startOrResume(): Uint8Array {
  return Uint8Array.of(ControlOpCode.startOrResume);
}

export function stop(): Uint8Array {
  return Uint8Array.of(ControlOpCode.stopOrPause, StopOrPauseParameter.stop);
}

export function pause(): Uint8Array {
  return Uint8Array.of(ControlOpCode.stopOrPause, StopOrPauseParameter.pause);
}

/** Target speed, uint16 at 0.01 km/h resolution. */
export function setTargetSpeed(speedKph: number): Uint8Array {
  const raw = Math.round(speedKph * 100);
  if (!Number.isFinite(raw) || raw < 0 || raw > 0xffff) {
    throw new RangeError(`Target speed ${speedKph} km/h is outside the encodable range`);
  }

  const payload = new Uint8Array(3);
  const view = new DataView(payload.buffer);
  view.setUint8(0, ControlOpCode.setTargetSpeed);
  view.setUint16(1, raw, true);
  return payload;
}

/** Target incline, sint16 at 0.1 % resolution. Negative values are declines. */
export function setTargetInclination(inclinePercent: number): Uint8Array {
  const raw = Math.round(inclinePercent * 10);
  if (!Number.isFinite(raw) || raw < -0x8000 || raw > 0x7fff) {
    throw new RangeError(`Target incline ${inclinePercent}% is outside the encodable range`);
  }

  const payload = new Uint8Array(3);
  const view = new DataView(payload.buffer);
  view.setUint8(0, ControlOpCode.setTargetInclination);
  view.setInt16(1, raw, true);
  return payload;
}

export interface ControlPointResponse {
  requestOpCode: number;
  resultCode: number;
  succeeded: boolean;
  /** Human-readable reason, suitable for surfacing directly in the UI. */
  message: string;
  /** Trailing bytes, used by op codes such as Spin Down Control. */
  parameter?: Uint8Array;
}

/**
 * Parses an indication from the control point.
 *
 * Throws when the payload is not an 0x80 response, since anything else on this
 * characteristic means the peripheral is not following the spec and silently
 * treating it as failure would hide the bug.
 */
export function parseControlPointResponse(
  source: DataView | ArrayBuffer | Uint8Array,
): ControlPointResponse {
  const cursor = new ByteCursor(source);

  if (!cursor.has(3)) {
    throw new Error("Control Point response must be at least 3 bytes");
  }

  const responseCode = cursor.uint8();
  if (responseCode !== ControlOpCode.responseCode) {
    throw new Error(
      `Expected Control Point response code 0x80 but received 0x${responseCode
        .toString(16)
        .padStart(2, "0")}`,
    );
  }

  const requestOpCode = cursor.uint8();
  const resultCode = cursor.uint8();

  const parameter = new Uint8Array(cursor.remaining);
  for (let index = 0; index < parameter.length; index += 1) {
    parameter[index] = cursor.uint8();
  }

  const succeeded = resultCode === ControlResultCode.success;

  return {
    requestOpCode,
    resultCode,
    succeeded,
    message: succeeded
      ? `${describeOpCode(requestOpCode)} succeeded`
      : `${describeOpCode(requestOpCode)} failed: ${describeResultCode(resultCode)}`,
    parameter: parameter.length > 0 ? parameter : undefined,
  };
}
