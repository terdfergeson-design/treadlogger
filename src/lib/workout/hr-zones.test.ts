import { describe, expect, it } from "vitest";
import { emptyTimeInZones, zoneBoundsBpm, zoneForHeartRate, HEART_RATE_ZONES } from "./hr-zones";

describe("zoneForHeartRate", () => {
  const MAX = 190;

  it("places readings in the right zone", () => {
    expect(zoneForHeartRate(105, MAX)?.index).toBe(1); // 55 %
    expect(zoneForHeartRate(123, MAX)?.index).toBe(2); // 65 %
    expect(zoneForHeartRate(142, MAX)?.index).toBe(3); // 75 %
    expect(zoneForHeartRate(161, MAX)?.index).toBe(4); // 85 %
    expect(zoneForHeartRate(180, MAX)?.index).toBe(5); // 95 %
  });

  it("puts a boundary reading in the higher zone", () => {
    expect(zoneForHeartRate(0.6 * MAX, MAX)?.index).toBe(2);
    expect(zoneForHeartRate(0.9 * MAX, MAX)?.index).toBe(5);
  });

  it("has no zone below half of maximum heart rate", () => {
    expect(zoneForHeartRate(80, MAX)).toBeNull();
  });

  it("keeps efforts above maximum in zone 5 rather than off the scale", () => {
    expect(zoneForHeartRate(205, MAX)?.index).toBe(5);
  });

  it("returns nothing when maximum heart rate is unknown", () => {
    expect(zoneForHeartRate(150, 0)).toBeNull();
  });
});

describe("zoneBoundsBpm", () => {
  it("converts fractions into beats per minute", () => {
    expect(zoneBoundsBpm(HEART_RATE_ZONES[1], 190)).toEqual({ lowerBpm: 114, upperBpm: 133 });
  });

  it("leaves zone 5 open-ended", () => {
    expect(zoneBoundsBpm(HEART_RATE_ZONES[4], 190)).toEqual({ lowerBpm: 171, upperBpm: null });
  });
});

describe("emptyTimeInZones", () => {
  it("starts every bucket at zero, including the sub-zone bucket", () => {
    expect(emptyTimeInZones()).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});
