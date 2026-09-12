import { Encoder, Profile } from "@garmin/fitsdk";
import type {
  ActivityMesg,
  DeviceInfoMesg,
  Encodable,
  EventMesg,
  FileCreatorMesg,
  FileIdMesg,
  LapMesg,
  RecordMesg,
  SessionMesg,
} from "@garmin/fitsdk";
import type { WorkoutSample, WorkoutSnapshot } from "../workout/session";

/**
 * Encodes a completed workout as a FIT Activity file.
 *
 * Uses Garmin's official FIT JavaScript SDK, which is pure JavaScript over
 * `DataView` and runs unchanged in the browser, so the file is produced entirely
 * client-side with no upload. The SDK owns the framing that is easy to get
 * wrong — file header, message definitions, the two CRCs, and unapplying each
 * field's scale — leaving this module responsible for the message content and
 * ordering that make the file a valid *activity*:
 *
 *   file_id → file_creator → device_info → timer start event → record… →
 *   timer stop event → lap → session → activity
 *
 * Garmin Connect, Strava and other importers reject files that carry records
 * without the surrounding session and activity messages, so all of them are
 * always written even for a very short workout.
 */

/** Version reported in file_creator and device_info. */
const APP_SOFTWARE_VERSION = 1.0;
const APP_PRODUCT_NAME = "Treadlink";

/** file_id.product, a free choice under the development manufacturer id. */
const APP_PRODUCT_ID = 1;

export interface FitActivityInput {
  samples: WorkoutSample[];
  startedAt: Date;
  endedAt: Date;
  /** Moving time in seconds, excluding pauses. */
  timerTimeS: number;
  /** Wall-clock seconds from start to finish, including pauses. */
  totalElapsedTimeS: number;
  totalDistanceM: number;
  totalEnergyKcal: number;
  totalAscentM: number;
  avgSpeedKph: number;
  maxSpeedKph: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  minHeartRateBpm?: number;
  maxInclinePercent?: number;
  /** Shown as the treadmill's descriptor in device_info. */
  treadmillName?: string;
  heartRateMonitorName?: string;
  /** Marks the file as simulator-generated so it is never mistaken for a run. */
  simulated?: boolean;
  serialNumber?: number;
}

/**
 * FIT stores speed as metres per second (profile scale 1000). That is the
 * format's required unit — Garmin Connect, Strava and every other importer
 * expect m/s — so the encoder always writes m/s derived from the app's
 * internal km/h. The mph/km/h setting is a display choice and must not be
 * written into the file, or a 3.2 mph run would be read as 3.2 m/s (11.5 km/h).
 */
const KPH_TO_MPS = 1 / 3.6;

/** FIT stores heart rate and calories as integers; round rather than truncate. */
const asInteger = (value: number | undefined): number | undefined =>
  value === undefined || !Number.isFinite(value) ? undefined : Math.round(value);

/**
 * FIT timestamps have one-second resolution, so two samples inside the same
 * second would collide. Keeps the last sample for each second and orders them,
 * since records must be chronological.
 */
function toRecordsPerSecond(samples: WorkoutSample[]): WorkoutSample[] {
  const bySecond = new Map<number, WorkoutSample>();
  for (const sample of samples) {
    bySecond.set(Math.floor(sample.timestamp / 1_000), sample);
  }
  return [...bySecond.entries()].sort(([a], [b]) => a - b).map(([, sample]) => sample);
}

/**
 * Totals shared by the lap and the session.
 *
 * Both messages summarise the same single-lap workout, so the fields are built
 * once. Enum values are kept as literals so they type-check against the FIT
 * profile's union types.
 */
function summaryFields(input: FitActivityInput) {
  return {
    startTime: input.startedAt,
    timestamp: input.endedAt,
    totalElapsedTime: input.totalElapsedTimeS,
    totalTimerTime: input.timerTimeS,
    totalDistance: input.totalDistanceM,
    totalCalories: asInteger(input.totalEnergyKcal),
    totalAscent: asInteger(input.totalAscentM),
    avgSpeed: input.avgSpeedKph * KPH_TO_MPS,
    maxSpeed: input.maxSpeedKph * KPH_TO_MPS,
    sport: "running" as const,
    subSport: "treadmill" as const,
    avgHeartRate: asInteger(input.avgHeartRateBpm),
    maxHeartRate: asInteger(input.maxHeartRateBpm),
    minHeartRate: asInteger(input.minHeartRateBpm),
    maxPosGrade: input.maxInclinePercent,
  };
}

export function encodeFitActivity(input: FitActivityInput): Uint8Array {
  const encoder = new Encoder();
  const records = toRecordsPerSecond(input.samples);
  const serialNumber = input.serialNumber ?? 1;

  const fileId: Encodable<FileIdMesg> = {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    // 255 / "development" is the manufacturer id reserved for software without a
    // registered Garmin id, which is the honest choice for this app.
    manufacturer: "development",
    product: APP_PRODUCT_ID,
    serialNumber,
    timeCreated: input.startedAt,
  };
  encoder.writeMesg(fileId);

  const fileCreator: Encodable<FileCreatorMesg> = {
    mesgNum: Profile.MesgNum.FILE_CREATOR,
    softwareVersion: APP_SOFTWARE_VERSION,
  };
  encoder.writeMesg(fileCreator);

  const creator: Encodable<DeviceInfoMesg> = {
    mesgNum: Profile.MesgNum.DEVICE_INFO,
    timestamp: input.startedAt,
    deviceIndex: "creator",
    manufacturer: "development",
    product: APP_PRODUCT_ID,
    productName: input.simulated ? `${APP_PRODUCT_NAME} (simulator)` : APP_PRODUCT_NAME,
    softwareVersion: APP_SOFTWARE_VERSION,
    sourceType: "local",
    serialNumber,
  };
  encoder.writeMesg(creator);

  if (input.treadmillName) {
    const treadmillDevice: Encodable<DeviceInfoMesg> = {
      mesgNum: Profile.MesgNum.DEVICE_INFO,
      timestamp: input.startedAt,
      deviceIndex: 1,
      sourceType: "bluetoothLowEnergy",
      descriptor: input.treadmillName,
    };
    encoder.writeMesg(treadmillDevice);
  }

  if (input.heartRateMonitorName) {
    const strapDevice: Encodable<DeviceInfoMesg> = {
      mesgNum: Profile.MesgNum.DEVICE_INFO,
      timestamp: input.startedAt,
      deviceIndex: 2,
      sourceType: "bluetoothLowEnergy",
      bleDeviceType: "heartRate",
      descriptor: input.heartRateMonitorName,
    };
    encoder.writeMesg(strapDevice);
  }

  // Timer events bracket the records and tell a reader where the clock ran.
  const timerStart: Encodable<EventMesg> = {
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: input.startedAt,
    event: "timer",
    eventType: "start",
  };
  encoder.writeMesg(timerStart);

  for (const sample of records) {
    const record: Encodable<RecordMesg> = {
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: new Date(sample.timestamp),
      distance: sample.distanceM,
      speed: sample.speedKph * KPH_TO_MPS,
      heartRate: asInteger(sample.heartRateBpm),
      // FIT calls treadmill incline "grade", in percent.
      grade: sample.inclinePercent,
      cadence: asInteger(sample.cadenceSpm),
    };
    encoder.writeMesg(record);
  }

  const timerStop: Encodable<EventMesg> = {
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: input.endedAt,
    event: "timer",
    eventType: "stopAll",
  };
  encoder.writeMesg(timerStop);

  // A single lap covering the whole workout. Readers expect at least one.
  const lap: Encodable<LapMesg> = {
    mesgNum: Profile.MesgNum.LAP,
    messageIndex: 0,
    event: "lap",
    eventType: "stop",
    lapTrigger: "sessionEnd",
    intensity: "active",
    ...summaryFields(input),
  };
  encoder.writeMesg(lap);

  const session: Encodable<SessionMesg> = {
    mesgNum: Profile.MesgNum.SESSION,
    messageIndex: 0,
    event: "session",
    eventType: "stop",
    trigger: "activityEnd",
    firstLapIndex: 0,
    numLaps: 1,
    ...summaryFields(input),
  };
  encoder.writeMesg(session);

  const activity: Encodable<ActivityMesg> = {
    mesgNum: Profile.MesgNum.ACTIVITY,
    timestamp: input.endedAt,
    totalTimerTime: input.timerTimeS,
    numSessions: 1,
    type: "manual",
    event: "activity",
    eventType: "stop",
    localTimestamp: toLocalTimestamp(input.endedAt),
  };
  encoder.writeMesg(activity);

  return encoder.close();
}

/**
 * FIT's `local_timestamp` is the UTC timestamp shifted by the local UTC offset,
 * which is how a reader recovers the wall-clock time of the workout without
 * knowing the runner's timezone.
 */
function toLocalTimestamp(date: Date): number {
  const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
  const offsetSeconds = -date.getTimezoneOffset() * 60;
  return Math.round((date.getTime() - FIT_EPOCH_MS) / 1_000) + offsetSeconds;
}

export interface ActivityMetadata {
  treadmillName?: string;
  heartRateMonitorName?: string;
  simulated?: boolean;
}

/** Projects a finished workout snapshot onto the encoder's input. */
export function fitActivityInputFromWorkout(
  snapshot: WorkoutSnapshot,
  metadata: ActivityMetadata = {},
): FitActivityInput {
  if (snapshot.startedAt === undefined) {
    throw new Error("Cannot export a workout that never started.");
  }

  const endedAt = snapshot.endedAt ?? snapshot.samples.at(-1)?.timestamp ?? Date.now();

  return {
    samples: snapshot.samples,
    startedAt: new Date(snapshot.startedAt),
    endedAt: new Date(endedAt),
    timerTimeS: snapshot.elapsedS,
    totalElapsedTimeS: snapshot.totalElapsedS,
    totalDistanceM: snapshot.distanceM,
    totalEnergyKcal: snapshot.energyKcal,
    totalAscentM: snapshot.elevationGainM,
    avgSpeedKph: snapshot.avgSpeedKph,
    maxSpeedKph: snapshot.maxSpeedKph,
    avgHeartRateBpm: snapshot.avgHeartRateBpm,
    maxHeartRateBpm: snapshot.maxHeartRateBpm,
    minHeartRateBpm: snapshot.minHeartRateBpm,
    maxInclinePercent: snapshot.maxInclinePercent,
    ...metadata,
  };
}

/** Filename following the `YYYY-MM-DD-HHMMSS` convention used by watches. */
export function fitFileName(startedAt: Date, simulated = false): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const stamp = [
    startedAt.getFullYear(),
    pad(startedAt.getMonth() + 1),
    pad(startedAt.getDate()),
  ].join("-");
  const time = [
    pad(startedAt.getHours()),
    pad(startedAt.getMinutes()),
    pad(startedAt.getSeconds()),
  ].join("");

  return `treadlink-${stamp}-${time}${simulated ? "-simulated" : ""}.fit`;
}
