import { afterEach, describe, expect, it } from "vitest";

import {
  formatDateOnly,
  formatDateTime,
} from "@/features/assayindex/utils/formatting";

const INITIAL_TIME_ZONE = process.env.TZ;
const UTC_BOUNDARY = "2026-08-13T00:06:24.807Z";

afterEach(() => {
  if (INITIAL_TIME_ZONE === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = INITIAL_TIME_ZONE;
  }
});

function formatBoundaryIn(timeZone: string) {
  process.env.TZ = timeZone;

  return {
    date: formatDateOnly(UTC_BOUNDARY),
    dateTime: formatDateTime(UTC_BOUNDARY),
  };
}

describe("AssayIndex date formatting", () => {
  it("renders UTC dates identically across server and browser time zones", () => {
    const expected = {
      date: "Aug 13, 2026",
      dateTime: "Aug 13, 2026, 12:06 AM",
    };

    expect(formatBoundaryIn("UTC")).toEqual(expected);
    expect(formatBoundaryIn("Pacific/Honolulu")).toEqual(expected);
    expect(formatBoundaryIn("Asia/Tokyo")).toEqual(expected);
  });
});
