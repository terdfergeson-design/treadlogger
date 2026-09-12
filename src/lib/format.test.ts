import { describe, expect, it } from "vitest";
import {
  formatPace,
  formatPaceWithUnit,
  formatSpeed,
  formatSpeedRange,
  formatSpeedWithUnit,
  paceUnitLabel,
  speedUnitLabel,
} from "./format";

describe("speed display unit", () => {
  it("labels km/h by default and mph when asked", () => {
    expect(speedUnitLabel()).toBe("km/h");
    expect(speedUnitLabel("kph")).toBe("km/h");
    expect(speedUnitLabel("mph")).toBe("mph");
    expect(paceUnitLabel("kph")).toBe("/km");
    expect(paceUnitLabel("mph")).toBe("/mi");
  });

  it("keeps the numeric value and the label in the same unit", () => {
    // 8.04672 km/h is exactly 5 mph.
    expect(formatSpeed(8.04672)).toBe("8.0");
    expect(formatSpeed(8.04672, "kph")).toBe("8.0");
    expect(formatSpeed(8.04672, "mph")).toBe("5.0");

    expect(formatSpeedWithUnit(8.04672, "kph")).toBe("8.0 km/h");
    expect(formatSpeedWithUnit(8.04672, "mph")).toBe("5.0 mph");
  });

  it("renders the advertised bounds in the same unit as the control", () => {
    // A machine that advertises 0.5–12.0 mph must not be labelled km/h.
    expect(formatSpeedRange(0.804672, 19.312128, "mph")).toBe("0.5–12.0 mph");
    expect(formatSpeedRange(0.5, 12, "kph")).toBe("0.5–12.0 km/h");
  });

  it("never pairs a km/h number with an mph label", () => {
    const shown = formatSpeedWithUnit(5.152, "mph");
    expect(shown.endsWith(" mph")).toBe(true);
    expect(shown.startsWith("3.2")).toBe(true);
    expect(shown).not.toContain("km/h");
  });
});

describe("pace display unit", () => {
  it("converts minutes per kilometre into minutes per mile", () => {
    // 6:00 /km is 9:39 /mi at the international mile.
    expect(formatPace(6, "kph")).toBe("6:00");
    expect(formatPace(6, "mph")).toBe("9:39");
    expect(formatPaceWithUnit(6, "kph")).toBe("6:00 /km");
    expect(formatPaceWithUnit(6, "mph")).toBe("9:39 /mi");
  });
});
