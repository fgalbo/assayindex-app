import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCdcTestDirectoryXml } from "@/features/assayindex/acquisition/cdc-test-directory";

function fixturePath(fileName: string) {
  return resolve(
    process.cwd(),
    "tests",
    "assayindex",
    "fixtures",
    "acquisition",
    "cdc",
    fileName,
  );
}

async function loadFixture(fileName: string) {
  return readFile(fixturePath(fileName), "utf8");
}

describe("CDC Infectious Diseases Test Order Directory acquisition", () => {
  it("parses source-listed test offerings into a deterministic flat candidate shape", async () => {
    const result = parseCdcTestDirectoryXml(
      `\uFEFF${await loadFixture("test-directory.sample.xml")}`,
    );

    expect(result.sourceGeneratedAt).toBe("2026-08-03T10:06:35");
    expect(result.issues).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.externalRecordId)).toEqual([
      "CDC-10471",
      "CDC-10472",
    ]);
    expect(result.candidates[0]).toEqual({
      externalRecordId: "CDC-10471",
      providerId: "cdc-infectious-diseases-laboratories",
      providerName: "CDC Infectious Diseases Laboratories",
      sourceTestId: "10471",
      sourceLabId: "11",
      sourceUnitNumber: "1",
      testName: "Ebola Virus Disease Testing",
      aliases: ["Ebola Virus Disease Test", "EVD testing"],
      method: "RT-PCR",
      turnaroundTimeText: "Contact CDC before submission. Timing varies.",
      turnaroundTime: null,
      acceptableSampleForTestingText: "Whole blood",
      minimumVolume: null,
      storageAndPreservation: "Freeze.",
      transport: "Contact CDC.",
      shippingInstructions: "Follow special-permit instructions.",
      interferencesAndLimitations: null,
      additionalInformation: "For professional public-health use.",
      supplementalInformationRequired: null,
      specimenLabeling: null,
      sourceLinkText: null,
      legacyLinkText: null,
      sourceLinks: [],
      orderStatus: "This Test Order is currently accepting specimens.",
      offline: false,
      clia: false,
      priorApprovalRequired: false,
      performedOn: { human: true, animal: true, other: false },
      contacts: {
        cdc: [{ name: "Katherine Johnson", phone: null, email: "katherine@example.cdc.gov" }],
        priorApproval: [],
      },
      sourceVersion: "2.0",
      detailUrl:
        "https://www.cdc.gov/laboratory/specimen-submission/detail.html?CDCTestCode=CDC-10471",
      reviewFlags: ["non_clia"],
      candidateState: "discovered-review-required",
    });
  });

  it("decodes source markup once, normalizes blanks, and preserves offline review context", async () => {
    const result = parseCdcTestDirectoryXml(
      await loadFixture("test-directory.sample.xml"),
    );
    const candidate = result.candidates[1];

    expect(candidate.aliases).toEqual(["Zika RT-PCR", "ZIKV PCR"]);
    expect(candidate.turnaroundTimeText).toBe(
      "7 Days Preliminary results may be available earlier.",
    );
    expect(candidate.turnaroundTime).toEqual({ value: 7, unit: "day" });
    expect(candidate.acceptableSampleForTestingText).toBe("Serum\nUrine");
    expect(candidate.storageAndPreservation).toBe("Refrigerate at 2–8°C.");
    expect(candidate.additionalInformation).toBe(
      'Call before sending an "urgent" specimen & document approval.',
    );
    expect(candidate.contacts).toEqual({
      cdc: [{ name: "Ada Lovelace", phone: "404-555-0101", email: "ada@example.cdc.gov" }],
      priorApproval: [
        { name: "Grace Hopper", phone: "404-555-0102", email: "grace@example.cdc.gov" },
      ],
    });
    expect(candidate.reviewFlags).toEqual([
      "source_offline",
      "source_status_unavailable",
      "prior_approval_required",
    ]);
    expect(candidate.candidateState).toBe("discovered-review-required");

    const punctuationSentinel = parseCdcTestDirectoryXml(
      (await loadFixture("test-directory.sample.xml")).replace(
        "<MinimumVolume>N/A</MinimumVolume>",
        "<MinimumVolume>Not Applicable.</MinimumVolume>",
      ),
    );
    expect(punctuationSentinel.candidates[0].minimumVolume).toBeNull();
  });

  it("preserves submission guidance and vetted source links without interpreting them", async () => {
    const valid = await loadFixture("test-directory.sample.xml");
    const input = valid.replace(
      "<AdditionalInfo>Call before sending an &amp;quot;urgent&amp;quot; specimen &amp;amp; document approval.</AdditionalInfo>",
      [
        "<AdditionalInfo>Call before sending an &amp;quot;urgent&amp;quot; specimen &amp;amp; document approval.</AdditionalInfo>",
        "<SupplementalInformationRequired>Complete the CDC 50.34 form.&lt;br&gt;Include clinical history.</SupplementalInformationRequired>",
        "<SpecimenLabeling>Use two primary identifiers.</SpecimenLabeling>",
        "<Link>&lt;a target=\"_blank\" href=\"https://www.selectagents.gov/forms.html\"&gt;Select agent form&lt;/a&gt;</Link>",
        "<Linkold>#http://www.cdc.gov/legacy-form.pdf#</Linkold>",
      ].join(""),
    );
    const candidate = parseCdcTestDirectoryXml(input).candidates[1];

    expect(candidate.supplementalInformationRequired).toBe(
      "Complete the CDC 50.34 form.\nInclude clinical history.",
    );
    expect(candidate.specimenLabeling).toBe("Use two primary identifiers.");
    expect(candidate.sourceLinkText).toBe("Select agent form");
    expect(candidate.sourceLinks).toEqual([
      { url: "http://www.cdc.gov/legacy-form.pdf", label: null },
      { url: "https://www.selectagents.gov/forms.html", label: "Select agent form" },
    ]);
  });

  it("removes source presentation markup without adding spaces before punctuation", async () => {
    const valid = await loadFixture("test-directory.sample.xml");
    const result = parseCdcTestDirectoryXml(
      valid.replace(
        "<AdditionalInfo>For professional public-health use.</AdditionalInfo>",
        "<AdditionalInfo>Salmonella &lt;em&gt;testing&lt;/em&gt;; sequence data.</AdditionalInfo>",
      ),
    );

    expect(result.candidates[0].additionalInformation).toBe(
      "Salmonella testing; sequence data.",
    );
  });

  it("keeps candidate content and ordering stable when source records are reordered", async () => {
    const original = parseCdcTestDirectoryXml(
      await loadFixture("test-directory.sample.xml"),
    );
    const reordered = parseCdcTestDirectoryXml(
      await loadFixture("test-directory.reordered.xml"),
    );

    expect(reordered).toEqual(original);
  });

  it("fails closed on schema drift instead of returning a partial catalog", async () => {
    const result = parseCdcTestDirectoryXml(
      await loadFixture("test-directory.schema-drift.xml"),
    );

    expect(result.candidates).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "schema_drift", field: "RenamedMethod" }),
    );

    const valid = await loadFixture("test-directory.sample.xml");
    const duplicateField = parseCdcTestDirectoryXml(
      valid.replace("<Method>RT-PCR</Method>", "<Method>RT-PCR</Method><Method>PCR</Method>"),
    );
    expect(duplicateField.candidates).toEqual([]);
    expect(duplicateField.issues).toContainEqual(
      expect.objectContaining({ code: "schema_drift", field: "Method" }),
    );
  });

  it("rejects malformed or unsafe XML constructs", async () => {
    const malformed = await loadFixture("test-directory.malformed.xml");
    const valid = await loadFixture("test-directory.sample.xml");

    expect(() => parseCdcTestDirectoryXml(malformed)).toThrow(/malformed|XML/i);
    expect(() =>
      parseCdcTestDirectoryXml(
        valid.replace("<dataroot", "<wrongroot").replace("</dataroot>", "</wrongroot>"),
      ),
    ).toThrow(/dataroot|root/i);
    expect(() =>
      parseCdcTestDirectoryXml(
        "<?xml version=\"1.0\"?><dataroot generated=\"2026-08-03T10:06:35\"><records><QryTableMerge><CDCTestCode>CDC-1</CDCTestCode><TestOrderNamSort>Nested</TestOrderNamSort></QryTableMerge></records></dataroot>",
      ),
    ).toThrow(/QryTableMerge|record|root/i);
    expect(() =>
      parseCdcTestDirectoryXml(valid.replace(' generated="2026-08-03T10:06:35"', "")),
    ).toThrow(/generated|timestamp/i);
    expect(() =>
      parseCdcTestDirectoryXml(
        valid.replace(
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<?xml version=\"1.0\"?><!DOCTYPE dataroot [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>",
        ),
      ),
    ).toThrow(/DOCTYPE|ENTITY|prohibited|unsafe/i);
    expect(() =>
      parseCdcTestDirectoryXml(valid.replace("RT-PCR", "<![CDATA[RT-PCR]]>")),
    ).toThrow(/CDATA|prohibited|unsafe/i);
    expect(() =>
      parseCdcTestDirectoryXml(valid.replace("RT-PCR", "&#0;")),
    ).toThrow(/invalid numeric entity|control character/i);
    expect(() =>
      parseCdcTestDirectoryXml(valid.replace("RT-PCR", "\u0001")),
    ).toThrow(/control character|prohibited/i);
    expect(() => parseCdcTestDirectoryXml(valid.replace("RT-PCR", "R&D"))).toThrow(
      /entity|malformed|unsupported/i,
    );
    expect(() => parseCdcTestDirectoryXml(valid.replace("RT-PCR", "&#-1;"))).toThrow(
      /entity|malformed|unsupported/i,
    );
    expect(() => parseCdcTestDirectoryXml(valid.replace("RT-PCR", "&unknown"))).toThrow(
      /entity|malformed|unsupported/i,
    );
  });

  it("reports missing and duplicate source identities without silently merging rows", async () => {
    const valid = await loadFixture("test-directory.sample.xml");
    const missing = parseCdcTestDirectoryXml(
      valid.replace("<CDCTestCode>CDC-10472</CDCTestCode>", "<CDCTestCode></CDCTestCode>"),
    );
    const duplicate = parseCdcTestDirectoryXml(
      valid.replace("<CDCTestCode>CDC-10472</CDCTestCode>", "<CDCTestCode>CDC-10471</CDCTestCode>"),
    );
    const malformed = parseCdcTestDirectoryXml(
      valid.replace("<CDCTestCode>CDC-10472</CDCTestCode>", "<CDCTestCode>../../escape</CDCTestCode>"),
    );

    expect(missing.issues).toContainEqual(expect.objectContaining({ code: "missing_identity" }));
    expect(missing.candidates).toHaveLength(1);
    expect(duplicate.issues).toContainEqual(expect.objectContaining({ code: "duplicate_id" }));
    expect(duplicate.candidates).toHaveLength(1);
    expect(malformed.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_value", field: "CDCTestCode" }),
    );
    expect(malformed.candidates).toHaveLength(1);
  });

  it("rejects a record missing a required source field", async () => {
    const valid = await loadFixture("test-directory.sample.xml");
    const result = parseCdcTestDirectoryXml(
      valid.replace(
        "<TestOrderNamSort>Zika Virus Molecular Detection</TestOrderNamSort>",
        "<TestOrderNamSort></TestOrderNamSort>",
      ),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "missing_required_field",
        field: "TestOrderNamSort",
      }),
    );
    expect(result.candidates).toHaveLength(1);
  });

  it.each([
    ["Offline", "2"],
    ["CLIA", "MAYBE"],
    ["PriorApprovalRequired", "sometimes"],
    ["PerformedOnHuman", "unknown"],
    ["TestOrderStatus", "Unexpected status"],
    ["TurnAroundTimeMeasure", "Fortnights"],
  ])("flags an unsupported %s source value", async (field, replacement) => {
    const valid = await loadFixture("test-directory.sample.xml");
    const input = valid.replace(
      new RegExp(`<${field}>[^<]*</${field}>`),
      `<${field}>${replacement}</${field}>`,
    );
    const result = parseCdcTestDirectoryXml(input);

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_value", field }),
    );
  });

  it("rejects an incoherent structured turnaround instead of inventing a duration", async () => {
    const valid = await loadFixture("test-directory.sample.xml");
    const result = parseCdcTestDirectoryXml(
      valid.replace("<TurnAroundTime>7</TurnAroundTime>", "<TurnAroundTime></TurnAroundTime>"),
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_value", field: "TurnAroundTime" }),
    );
  });

  it("normalizes the other observed structured turnaround unit", async () => {
    const valid = await loadFixture("test-directory.sample.xml");
    const result = parseCdcTestDirectoryXml(
      valid
        .replace("<TurnAroundTime>7</TurnAroundTime>", "<TurnAroundTime>2</TurnAroundTime>")
        .replace(
          "<TurnAroundTimeMeasure>Days</TurnAroundTimeMeasure>",
          "<TurnAroundTimeMeasure>Weeks</TurnAroundTimeMeasure>",
        ),
    );

    expect(result.issues).toEqual([]);
    expect(result.candidates[1].turnaroundTime).toEqual({ value: 2, unit: "week" });
  });
});
