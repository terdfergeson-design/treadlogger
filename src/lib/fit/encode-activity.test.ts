import { Decoder, Stream } from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import type { WorkoutSample } from "../workout/session";
import {
  encodeFitActivity,
  fitFileName,
  type FitActivityInput,
} from "./encode-activity";

/**
 * The encoder is verified by decoding its own output with the FIT SDK's decoder,
 * which validates the header, both CRCs and every message definition. A file that
 * survives that round trip is the same shape Garmin Connect and Strava expect.
 */

const START_MS = Date.UTC(2026, 0, 15, 7, 30, 0);

function buildSamples(count: number): WorkoutSample[] {
  const samples: WorkoutSample[] = [];
  let distanceM = 0;

  for (let second = 1; second <= count; second += 1) {
    const speedKph = 9 + (second % 5) * 0.5;
    distanceM += speedKph / 3.6;

    samples.push({
      timestamp: START_MS + second * 1_000,
      elapsedS: second,
      distanceM,
      speedKph,
      inclinePercent: second % 2 === 0 ? 2.5 : 1,
      heartRateBpm: 130 + (second % 10),
      energyKcal: second * 0.2,
    });
  }

  return samples;
}

function buildInput(overrides: Partial<FitActivityInput> = {}): FitActivityInput {
  const samples = overrides.samples ?? buildSamples(30);
  const last = samples.at(-1);

  return {
    samples,
    startedAt: new Date(START_MS),
    endedAt: new Date(START_MS + (last?.elapsedS ?? 30) * 1_000),
    timerTimeS: last?.elapsedS ?? 30,
    totalElapsedTimeS: last?.elapsedS ?? 30,
    totalDistanceM: last?.distanceM ?? 0,
    totalEnergyKcal: 6,
    totalAscentM: 3,
    avgSpeedKph: 10,
    maxSpeedKph: 11,
    avgHeartRateBpm: 134.6,
    maxHeartRateBpm: 139,
    minHeartRateBpm: 131,
    maxInclinePercent: 2.5,
    treadmillName: "THERUN T15",
    heartRateMonitorName: "Polar H10",
    serialNumber: 20260115,
    ...overrides,
  };
}

function decode(bytes: Uint8Array) {
  const stream = Stream.fromByteArray(bytes);
  expect(Decoder.isFIT(stream)).toBe(true);

  const decoder = new Decoder(stream);
  expect(decoder.checkIntegrity()).toBe(true);

  const { messages, errors } = decoder.read();
  expect(errors).toEqual([]);
  return messages;
}

/** Asserts a message collection is present and narrows away its optionality. */
function present<T>(collection: T[] | undefined, name: string): T[] {
  if (!collection) throw new Error(`Expected the file to contain ${name} messages`);
  return collection;
}

/**
 * FIT timestamps decode as a Date, and the profile type also admits raw seconds
 * and the sentinel "min". Only a real date is meaningful here.
 */
function millis(timestamp: number | Date | string | undefined): number {
  if (!(timestamp instanceof Date)) {
    throw new Error(`Expected a decoded Date timestamp but received ${String(timestamp)}`);
  }
  return timestamp.getTime();
}

describe("encodeFitActivity", () => {
  it("produces a file that decodes with valid framing and CRCs", () => {
    const bytes = encodeFitActivity(buildInput());

    expect(bytes.byteLength).toBeGreaterThan(14);
    // A FIT file starts with its header size and protocol version, then ".FIT".
    expect(bytes[0]).toBe(14);
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe(".FIT");

    decode(bytes);
  });

  it("writes a file_id that marks the file as an activity", () => {
    const messages = decode(encodeFitActivity(buildInput()));

    const fileIds = present(messages.fileIdMesgs, "file_id");

    expect(fileIds).toHaveLength(1);
    expect(fileIds[0]).toMatchObject({
      type: "activity",
      manufacturer: "development",
      serialNumber: 20260115,
    });
    expect(millis(fileIds[0].timeCreated)).toBe(START_MS);
  });

  it("round-trips every record field within FIT's stored resolution", () => {
    const samples = buildSamples(30);
    const messages = decode(encodeFitActivity(buildInput({ samples })));

    const records = present(messages.recordMesgs, "record");

    expect(records).toHaveLength(samples.length);

    samples.forEach((sample, index) => {
      const record = records[index];

      expect(millis(record.timestamp)).toBe(sample.timestamp);
      // distance is stored at 1/100 m, speed at 1/1000 m/s, grade at 1/100 %.
      expect(record.distance!).toBeCloseTo(sample.distanceM, 2);
      expect(record.speed!).toBeCloseTo(sample.speedKph / 3.6, 3);
      expect(record.grade!).toBeCloseTo(sample.inclinePercent!, 2);
      expect(record.heartRate).toBe(sample.heartRateBpm);
    });
  });

  it("halves cadence into FIT's single-foot convention so readers don't double it into 2x the real pace", () => {
    // Garmin Connect, Strava, etc. all double record.cadence back into a
    // total steps/min figure when displaying it, so the value we write must
    // already be halved — 168 total spm is a real, plausible running
    // cadence, and should round-trip as 84 in the raw field.
    const samples: WorkoutSample[] = [
      { timestamp: START_MS + 1_000, elapsedS: 1, distanceM: 2, speedKph: 9, cadenceSpm: 168 },
      { timestamp: START_MS + 2_000, elapsedS: 2, distanceM: 5, speedKph: 10, cadenceSpm: undefined },
    ];

    const messages = decode(encodeFitActivity(buildInput({ samples })));
    const records = present(messages.recordMesgs, "record");

    expect(records[0].cadence).toBe(84);
    expect(records[1].cadence).toBeUndefined();
  });

  it("writes each record's altitude from the running elevation profile", () => {
    const samples: WorkoutSample[] = [
      { timestamp: START_MS + 1_000, elapsedS: 1, distanceM: 2, speedKph: 9, elevationM: 1.4 },
      { timestamp: START_MS + 2_000, elapsedS: 2, distanceM: 5, speedKph: 10, elevationM: -0.6 },
    ];

    const messages = decode(encodeFitActivity(buildInput({ samples })));
    const records = present(messages.recordMesgs, "record");

    // altitude is stored at 1/5 m resolution.
    expect(records[0].altitude!).toBeCloseTo(1.4, 1);
    expect(records[1].altitude!).toBeCloseTo(-0.6, 1);
  });

  it("writes the session totals a reader summarises the workout from", () => {
    const input = buildInput();
    const messages = decode(encodeFitActivity(input));

    const sessions = present(messages.sessionMesgs, "session");

    expect(sessions).toHaveLength(1);
    const session = sessions[0];

    expect(session).toMatchObject({
      sport: "running",
      subSport: "treadmill",
      event: "session",
      eventType: "stop",
      numLaps: 1,
      firstLapIndex: 0,
      totalCalories: 6,
      totalAscent: 3,
    });

    expect(millis(session.startTime)).toBe(START_MS);
    expect(session.totalTimerTime!).toBeCloseTo(input.timerTimeS, 3);
    expect(session.totalElapsedTime!).toBeCloseTo(input.totalElapsedTimeS, 3);
    expect(session.totalDistance!).toBeCloseTo(input.totalDistanceM, 2);
    expect(session.avgSpeed!).toBeCloseTo(input.avgSpeedKph / 3.6, 3);
    expect(session.maxSpeed!).toBeCloseTo(input.maxSpeedKph / 3.6, 3);
    // Heart rate is a uint8 in FIT, so the average is rounded on the way in.
    expect(session.avgHeartRate).toBe(135);
    expect(session.maxHeartRate).toBe(139);
    expect(session.minHeartRate).toBe(131);
  });

  it("writes exactly one lap spanning the whole workout", () => {
    const input = buildInput();
    const messages = decode(encodeFitActivity(input));

    const laps = present(messages.lapMesgs, "lap");

    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({
      messageIndex: 0,
      event: "lap",
      eventType: "stop",
      lapTrigger: "sessionEnd",
      intensity: "active",
    });
    expect(laps[0].totalDistance!).toBeCloseTo(input.totalDistanceM, 2);
  });

  it("closes the file with an activity message", () => {
    const input = buildInput();
    const messages = decode(encodeFitActivity(input));

    const activities = present(messages.activityMesgs, "activity");

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      numSessions: 1,
      type: "manual",
      event: "activity",
      eventType: "stop",
    });
    expect(activities[0].totalTimerTime!).toBeCloseTo(input.timerTimeS, 3);
  });

  it("brackets the records with timer start and stop events", () => {
    const messages = decode(encodeFitActivity(buildInput()));

    const events = present(messages.eventMesgs, "event");

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "timer", eventType: "start" });
    expect(events[1]).toMatchObject({ event: "timer", eventType: "stopAll" });
  });

  it("records both Bluetooth devices alongside the app itself", () => {
    const messages = decode(encodeFitActivity(buildInput()));
    const devices = present(messages.deviceInfoMesgs, "device_info");
    const descriptors = devices.map((device) => device.descriptor);

    expect(descriptors).toContain("THERUN T15");
    expect(descriptors).toContain("Polar H10");
    expect(devices[0]).toMatchObject({
      deviceIndex: "creator",
      sourceType: "local",
    });
  });

  it("collapses samples that land in the same second, since FIT stores whole seconds", () => {
    const samples: WorkoutSample[] = [
      { timestamp: START_MS + 1_000, elapsedS: 1, distanceM: 2, speedKph: 9 },
      { timestamp: START_MS + 1_400, elapsedS: 1.4, distanceM: 3, speedKph: 10 },
      { timestamp: START_MS + 2_000, elapsedS: 2, distanceM: 5, speedKph: 11 },
    ];

    const messages = decode(encodeFitActivity(buildInput({ samples })));

    const records = present(messages.recordMesgs, "record");

    expect(records).toHaveLength(2);
    // The later reading in a second wins.
    expect(records[0].distance!).toBeCloseTo(3, 2);
    expect(records[1].distance!).toBeCloseTo(5, 2);
  });

  it("orders records chronologically even when samples arrive out of order", () => {
    const samples: WorkoutSample[] = [
      { timestamp: START_MS + 3_000, elapsedS: 3, distanceM: 8, speedKph: 11 },
      { timestamp: START_MS + 1_000, elapsedS: 1, distanceM: 2, speedKph: 9 },
      { timestamp: START_MS + 2_000, elapsedS: 2, distanceM: 5, speedKph: 10 },
    ];

    const messages = decode(encodeFitActivity(buildInput({ samples })));
    const timestamps = present(messages.recordMesgs, "record").map((record) =>
      millis(record.timestamp),
    );

    expect(timestamps).toEqual([START_MS + 1_000, START_MS + 2_000, START_MS + 3_000]);
  });

  it("omits heart rate from records taken before the strap connected", () => {
    const samples: WorkoutSample[] = [
      { timestamp: START_MS + 1_000, elapsedS: 1, distanceM: 2, speedKph: 9 },
      { timestamp: START_MS + 2_000, elapsedS: 2, distanceM: 5, speedKph: 10, heartRateBpm: 128 },
    ];

    const messages = decode(
      encodeFitActivity(
        buildInput({ samples, avgHeartRateBpm: undefined, maxHeartRateBpm: undefined, minHeartRateBpm: undefined }),
      ),
    );

    const records = present(messages.recordMesgs, "record");

    expect(records[0].heartRate).toBeUndefined();
    expect(records[1].heartRate).toBe(128);
    expect(present(messages.sessionMesgs, "session")[0].avgHeartRate).toBeUndefined();
  });

  it("still writes a decodable file for a workout with no samples", () => {
    const messages = decode(encodeFitActivity(buildInput({ samples: [] })));

    expect(messages.recordMesgs ?? []).toHaveLength(0);
    expect(present(messages.sessionMesgs, "session")).toHaveLength(1);
    expect(present(messages.activityMesgs, "activity")).toHaveLength(1);
  });
});

describe("fitFileName", () => {
  it("uses a sortable timestamped name", () => {
    const name = fitFileName(new Date(2026, 0, 15, 7, 30, 5));

    expect(name).toBe("treadlogger-2026-01-15-073005.fit");
  });

  it("marks simulated workouts in the filename", () => {
    expect(fitFileName(new Date(2026, 0, 15, 7, 30, 5), true)).toBe(
      "treadlogger-2026-01-15-073005-simulated.fit",
    );
  });
});
