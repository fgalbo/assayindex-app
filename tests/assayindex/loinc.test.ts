import { describe, expect, it } from "vitest";

import { LOINC_LICENSE_URL, loincRecordUrl } from "@/features/assayindex/utils/loinc";

describe("LOINC official links", () => {
  it("builds an official record URL only for a valid LOINC code", () => {
    expect(loincRecordUrl("26028-1")).toBe("https://loinc.org/26028-1/");
    expect(loincRecordUrl(" 55135-8 ")).toBe("https://loinc.org/55135-8/");
    expect(loincRecordUrl("not-a-code")).toBeNull();
    expect(loincRecordUrl("26028-1/../../account")).toBeNull();
  });

  it("uses the official LOINC license page", () => {
    expect(LOINC_LICENSE_URL).toBe("https://loinc.org/license");
  });
});
