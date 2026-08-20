import { describe, expect, it } from "vitest";

import {
  federatedDetailResponseSchema,
  federatedSearchResponseSchema,
} from "@/features/assayindex/federated/schema";

const validSearchResponse = {
  requestId: "request-1",
  query: "HLA-B27",
  searchedAt: "2026-08-19T00:00:00.000Z",
  sources: {
    arup: {
      status: "success",
      cached: false,
      message: null,
      officialDirectoryUrl: "https://ltd.aruplab.com",
      results: [{
        sourceLab: "arup",
        sourceRef: "arup:test:0095840",
        sourceUrl: "https://ltd.aruplab.com/Tests/Pub/0095840",
        sourceTestCode: "0095840",
        title: "HLA-B27",
        summary: null,
        orderingRecommendation: null,
        sourceStatus: "A",
      }],
    },
  },
};

describe("shared federated client response schemas", () => {
  it("accepts a valid partial-source search response", () => {
    expect(federatedSearchResponseSchema.safeParse(validSearchResponse).success).toBe(true);
  });

  it("rejects malformed source result arrays and unknown states", () => {
    expect(federatedSearchResponseSchema.safeParse({
      ...validSearchResponse,
      sources: {
        arup: {
          status: "success",
          cached: false,
          message: null,
          officialDirectoryUrl: "https://ltd.aruplab.com",
          results: [{}],
        },
      },
    }).success).toBe(false);
    expect(federatedSearchResponseSchema.safeParse({
      ...validSearchResponse,
      sources: {
        arup: {
          status: "trusted",
          cached: false,
          message: null,
          officialDirectoryUrl: "https://ltd.aruplab.com",
          results: [],
        },
      },
    }).success).toBe(false);
  });

  it("rejects a success detail response whose parsed offering is incomplete", () => {
    expect(federatedDetailResponseSchema.safeParse({
      status: "success",
      parsed: { sourceTitle: "HLA-B27" },
    }).success).toBe(false);
  });
});
