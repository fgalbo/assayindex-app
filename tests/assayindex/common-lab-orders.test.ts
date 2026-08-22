import { describe, expect, it } from "vitest";

import commonLabOrderData from "@/features/assayindex/data/terminology/common-lab-orders.generated.json";
import mnemonicSupplement from "@/features/assayindex/data/terminology/common-mnemonic-supplement.source.json";
import { parseCommonLabOrderTerminologyIndex } from "@/features/assayindex/terminology/schema";
import {
  normalizeCommonLabOrderLimit,
  normalizeCommonLabOrderQuery,
  searchCommonLabOrders,
} from "@/features/assayindex/terminology/common-lab-orders.server";

const index = parseCommonLabOrderTerminologyIndex(commonLabOrderData);

describe("common laboratory order terminology", () => {
  it("validates the complete source-backed snapshot and required license notice", () => {
    expect(index.source.sourceId).toBe("nlm-loinc-universal-lab-orders-v2");
    expect(index.source.sourceEntryCount).toBe(1_523);
    expect(index.source.commonOrderPublishedEntryCount).toBe(1_523);
    expect(index.source.supplementalEntryCount).toBe(28);
    expect(index.source.publishedEntryCount).toBe(1_551);
    expect(index.source.publishedEntryCount).toBe(index.entries.length);
    expect(index.source.sourceSha256).toBe("72a889f5405d90c14028cda0d2901feadd9fd6041f1da3d71cdeb1a9a5c00427");
    expect(index.source.enrichment).toMatchObject({
      sourceId: "nlm-clinical-tables-loinc-v3",
      responseSha256: "47a8c45b3ccbe9a5ea95facb0630b34f506c7a0f2200ca4d0433ef41d20ed735",
      batchCount: 32,
      excludeCopyrighted: true,
      loincReleaseVersion: null,
      releaseVersionStatus: "not-exposed-by-source",
    });
    expect(index.source.mnemonicSupplement).toEqual({
      sourceId: "assayindex-curated-loinc-mnemonic-supplement-v1",
      selectionVersion: "1.0.0",
      codeSetSha256: "9c3fdd71b33b555d3458d84232e30bb5723095cdfaa2acaef78da84938acf2da",
      entryCount: 28,
    });
    expect(index.source.licenseNotice).toContain("This material contains content from LOINC");
    expect(index.source.licenseNotice).toContain("http://loinc.org/license");
  });

  it("publishes every audited supplemental code with explicit provenance and no invented order role", () => {
    const configuredCodes = mnemonicSupplement.concepts.flatMap((concept) => concept.loincCodes).toSorted();
    const supplementalEntries = index.entries
      .filter((entry) => entry.sourceScope === "assayindex-mnemonic-supplement")
      .toSorted((left, right) => left.loincCode.localeCompare(right.loincCode));

    expect(supplementalEntries.map((entry) => entry.loincCode)).toEqual(configuredCodes);
    expect(supplementalEntries.every((entry) => entry.orderObservation === null)).toBe(true);
  });

  it("rejects supplemental count metadata that drifts from the actual entries", () => {
    const invalidIndex = structuredClone(commonLabOrderData);
    invalidIndex.source.mnemonicSupplement.entryCount += 1;
    expect(() => parseCommonLabOrderTerminologyIndex(invalidIndex)).toThrow(/supplement metadata/i);
  });

  it.each([
    ["CBC", /complete blood count|CBC/i],
    ["CMP", /comprehensive metabolic/i],
    ["BMP", /basic metabolic/i],
    ["A1C", /A1c/i],
    ["HbA1c", /A1c/i],
    ["TSH", /thyroid|thyrotropin|TSH/i],
    ["PSA", /prostate|PSA/i],
    ["PT/INR", /prothrombin|INR/i],
    ["INR", /prothrombin time|INR/i],
    ["aPTT", /aPTT|partial thromboplastin/i],
    ["UA", /urinalysis/i],
    ["PCR", /PCR|polymerase chain reaction/i],
    ["NAAT", /nucleic acid|NAA/i],
    ["CTNG", /Chlamydia.*gonorrhoeae|gonorrhoeae.*Chlamydia/i],
  ])("finds a common-order concept for %s", (query, expectedName) => {
    const response = searchCommonLabOrders({ query, limit: 20, index });
    expect(response.matchedCount, query).toBeGreaterThan(0);
    expect(
      response.results.some((result) => expectedName.test(`${result.longCommonName} ${result.matchedTerm}`)),
      `${query}: ${response.results.map((result) => `${result.longCommonName} [${result.matchedTerm}]`).join(" | ")}`,
    ).toBe(true);
  });

  it.each([
    ["PTT", /partial thromboplastin|PTT/i],
    ["FT4", /thyroxine|T4/i],
    ["T3", /triiodothyronine|T3/i],
    ["hCG", /chorionic gonadotropin|hCG/i],
    ["ESR", /erythrocyte sedimentation|ESR/i],
    ["CRP", /C reactive protein|CRP/i],
    ["BNP", /natriuretic peptide|BNP/i],
    ["NT-proBNP", /natriuretic peptide|proBNP/i],
    ["D-dimer", /D.dimer/i],
    ["B12", /cobalamin|vitamin B12/i],
    ["TIBC", /iron binding capacity|TIBC/i],
    ["LFT", /hepatic function|LFT/i],
    ["RPR", /rapid plasma reagin|RPR/i],
    ["HBsAg", /hepatitis B(?: virus)? surface|HBsAg/i],
    ["HCV", /hepatitis C|HCV/i],
    ["LDH", /lactate dehydrogenase|LDH/i],
    ["CKMB", /creatine kinase.*MB|CKMB/i],
    ["eGFR", /glomerular filtration|eGFR/i],
    ["ANA", /antinuclear|ANA/i],
    ["RF", /rheumatoid factor|RF/i],
    ["CCP", /cyclic citrullinated|CCP/i],
    ["PTH", /parathyrin|parathyroid|PTH/i],
    ["FSH", /follitropin|follicle stimulating|FSH/i],
    ["LH", /lutropin|luteinizing|LH/i],
    ["ACTH", /corticotropin|ACTH/i],
  ])("covers the representative common mnemonic %s", (query, expectedTerm) => {
    const response = searchCommonLabOrders({ query, limit: 50, index });
    expect(response.matchedCount, query).toBeGreaterThan(0);
    expect(
      response.results.some((result) => expectedTerm.test(`${result.longCommonName} ${result.matchedTerm}`)),
      `${query}: ${response.results.map((result) => `${result.longCommonName} [${result.matchedTerm}]`).join(" | ")}`,
    ).toBe(true);
  });

  it.each([
    ["CBC", "Complete blood count (CBC)"],
    ["A1C", "Hemoglobin A1c (A1C/HbA1c)"],
    ["B12", "Vitamin B12 / cobalamin"],
    ["RPR", "Rapid plasma reagin (RPR)"],
    ["eGFR", "Estimated glomerular filtration rate (eGFR)"],
    ["T3", "Triiodothyronine (T3)"],
    ["ANA", "Antinuclear antibody (ANA)"],
    ["CMP", "Comprehensive metabolic panel (CMP)"],
    ["BMP", "Basic metabolic panel (BMP)"],
    ["TSH", "Thyroid-stimulating hormone / thyrotropin (TSH)"],
    ["PSA", "Prostate-specific antigen (PSA)"],
    ["PTT", "Activated partial thromboplastin time (aPTT/PTT)"],
    ["aPTT", "Activated partial thromboplastin time (aPTT/PTT)"],
    ["ESR", "Erythrocyte sedimentation rate (ESR)"],
    ["LFT", "Hepatic function panel (LFT)"],
    ["FT4", "Free thyroxine (FT4)"],
    ["hCG", "Human chorionic gonadotropin testing family (hCG)"],
    ["CRP", "C-reactive protein (CRP)"],
    ["BNP", "B-type natriuretic peptide (BNP)"],
    ["NT-proBNP", "N-terminal pro-B-type natriuretic peptide (NT-proBNP)"],
    ["D-dimer", "Fibrin D-dimer"],
    ["TIBC", "Total iron-binding capacity (TIBC)"],
    ["HCV", "Hepatitis C virus testing family (HCV)"],
    ["LDH", "Lactate dehydrogenase (LDH)"],
    ["CKMB", "Creatine kinase MB (CK-MB)"],
    ["RF", "Rheumatoid factor (RF)"],
    ["CCP", "Cyclic citrullinated peptide antibody (anti-CCP)"],
    ["PTH", "Intact parathyroid hormone / parathyrin (PTH)"],
    ["FSH", "Follicle-stimulating hormone / follitropin (FSH)"],
    ["LH", "Luteinizing hormone / lutropin (LH)"],
    ["ACTH", "Adrenocorticotropic hormone / corticotropin (ACTH)"],
    ["CTNG", "Combined Chlamydia trachomatis / Neisseria gonorrhoeae testing"],
    ["CT/NG", "Combined Chlamydia trachomatis / Neisseria gonorrhoeae testing"],
    ["GCCT", "Combined Chlamydia trachomatis / Neisseria gonorrhoeae testing"],
    ["GC/CT", "Combined Chlamydia trachomatis / Neisseria gonorrhoeae testing"],
    ["UA", "Urinalysis"],
    ["PT", "Prothrombin time (PT)"],
    ["PT/INR", "Prothrombin time / international normalized ratio (PT/INR)"],
    ["INR", "International normalized ratio (INR)"],
    ["UDS", "Urine drug screen (UDS)"],
    ["HBsAg", "Hepatitis B surface antigen (HBsAg)"],
  ])("records the evidence-backed interpretation used for %s", (query, label) => {
    const response = searchCommonLabOrders({ query, limit: 20, index });
    expect(response.interpretation).toMatchObject({
      interpretationType: "assayindex-search-heuristic",
      label,
      evidenceUrl: expect.stringMatching(/^https:\/\//),
    });
  });

  it("keeps UDS ambiguity and panel-composition limits explicit", () => {
    const response = searchCommonLabOrders({ query: "UDS", limit: 20, index });
    expect(response.interpretation?.ambiguityNote).toMatch(/outside laboratory ordering/i);
    expect(response.interpretation?.ambiguityNote).toMatch(/does not define a universal panel composition/i);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].longCommonName).toMatch(/Drugs of abuse 5 panel.*Urine.*Screen/i);
  });

  it("keeps uppercase EGFR gene searches separate from kidney eGFR terminology", () => {
    const geneSearch = searchCommonLabOrders({ query: "EGFR", index });
    expect(geneSearch.interpretation).toBeNull();
    expect(geneSearch.results.map((result) => result.loincCode)).not.toContain("45066-8");

    const kidneySearch = searchCommonLabOrders({ query: "eGFR", index });
    expect(kidneySearch.interpretation).toMatchObject({
      label: "Estimated glomerular filtration rate (eGFR)",
    });
    expect(kidneySearch.interpretation?.ambiguityNote).toMatch(/uppercase EGFR.*gene/i);
    expect(kidneySearch.results.map((result) => result.loincCode)).toContain("45066-8");
  });

  it.each([
    ["PT/INR", ["5902-2", "6301-6"]],
    ["INR", ["6301-6"]],
    ["CBC W DIFF", ["57021-8", "69742-5", "57022-6", "57782-5"]],
    ["LYTES", ["24326-1", "55231-5"]],
    ["HCG", [
      "2118-8", "2106-3", "19080-1", "25372-4", "2110-5", "2112-1", "21198-7",
      "2111-3", "2114-7", "43799-6", "2115-4", "30243-0", "45194-8", "53959-3",
    ]],
    ["WBC", ["26464-8", "6690-2"]],
    ["RBC", ["789-8"]],
    ["HGB", ["718-7"]],
    ["PLT", ["26515-7", "777-3"]],
    ["RETIC", ["4679-7", "17849-1"]],
    ["NA", ["2951-2", "2947-0"]],
    ["K+", ["2823-3", "6298-4"]],
    ["CL", ["2075-0", "2069-3"]],
    ["CO2", ["2028-9"]],
    ["BUN", ["3094-0", "6299-2"]],
    ["BUN/CR", ["3097-3"]],
    ["CR", ["2160-0", "38483-4", "5619-2", "5622-6"]],
    ["CREA", ["2160-0", "38483-4"]],
    ["CRCL", ["34555-3", "58446-6"]],
    ["GLU", ["2345-7", "2339-0", "1558-6"]],
    ["FBS", ["1558-6"]],
    ["CA", ["17861-6", "49765-1"]],
    ["MG", ["19123-9", "2601-3"]],
    ["PHOS", ["2777-1"]],
    ["AST", ["1920-8"]],
    ["SGOT", ["1920-8"]],
    ["ALT", ["1742-6"]],
    ["SGPT", ["1742-6"]],
    ["ALP", ["6768-6"]],
    ["GGT", ["2324-2"]],
    ["TBILI", ["1975-2"]],
    ["DBILI", ["1968-7"]],
    ["ALB", ["1751-7"]],
    ["TP", ["2885-2"]],
    ["LIPID", ["24331-1", "57698-3"]],
    ["TC", ["2093-3"]],
    ["HDL", ["2085-9"]],
    ["LDL", ["2089-1", "18262-6"]],
    ["NONHDL", ["43396-1"]],
    ["TG", ["2571-8", "3043-7", "3013-0", "15210-8", "5381-9", "8098-6", "38505-4"]],
    ["OGTT", ["24353-5", "50608-9"]],
    ["T4", ["3026-2"]],
    ["FT3", ["3051-0"]],
    ["TPO", ["32786-6", "8099-4"]],
    ["TGAB", ["15210-8", "5381-9"]],
    ["TRAB", ["57416-0"]],
    ["FIB", ["3255-7", "3256-5"]],
    ["LACTATE", ["2524-7", "32693-4", "14118-4"]],
    ["TROP", ["42757-5", "10839-9", "49563-0", "6598-7"]],
    ["TNI", ["42757-5", "10839-9", "49563-0"]],
    ["TNT", ["6598-7"]],
    ["CK", ["2157-6"]],
    ["CPK", ["2157-6"]],
    ["FERRITIN", ["2276-4"]],
    ["IRON", ["2498-4"]],
    ["FOLATE", ["2284-8", "2283-0", "2282-2"]],
    ["UPCR", ["2890-2"]],
    ["CORTISOL", ["2143-6", "9813-7", "9812-9", "2145-1", "2142-8", "2147-7", "11040-3"]],
    ["PRL", ["2842-3", "20568-2"]],
    ["E2", ["2243-4", "35384-7"]],
    ["TESTOSTERONE", ["2986-8", "49041-7"]],
    ["HIV", [
      "7918-6", "31201-7", "48345-3", "7917-8", "29893-5", "24012-7",
      "49580-4", "30361-0", "5222-5", "5221-7", "5225-8", "25835-0", "25836-8",
      "23876-6", "20447-9", "29539-4", "29541-0", "22357-8", "48346-1", "44533-8",
    ]],
    ["HCV", [
      "16128-1", "13955-0", "5198-7", "5199-5", "48159-8", "11259-9", "20416-4",
      "11011-4", "47252-2", "38180-6", "32286-7", "47441-1", "49846-9",
    ]],
    ["HBSAB", ["22322-2", "10900-9", "16935-9", "5194-6", "5193-8"]],
    ["HBCAB", ["16933-4", "47440-3", "13952-7", "5187-0"]],
    ["HAV", ["13951-9", "5183-9", "22314-9", "13950-1", "22315-6", "5181-3"]],
    ["VDRL", ["5292-8", "5290-2"]],
    ["FLU", [
      "72366-8", "48509-4", "5862-8", "5863-6", "46083-2", "5866-9",
      "24015-0", "6437-8", "6438-6", "6604-3",
    ]],
    ["RSV", ["5876-8", "5877-6"]],
    ["MONO", ["31418-7", "5213-4"]],
    ["C3", ["4485-9"]],
    ["C4", ["4498-2"]],
    ["CH50", ["4532-8"]],
    ["SPEP", ["24351-9"]],
    ["FOBT", ["2335-8", "29771-3"]],
    ["FIT", ["29771-3"]],
    ["ABO", ["883-9", "882-1", "34530-6"]],
    ["RH", ["10331-7", "882-1", "34530-6"]],
    ["ABORH", ["882-1", "34530-6"]],
    ["AB SCREEN", ["890-4"]],
    ["DAT", ["1007-4"]],
    ["IAT", ["1003-3"]],
    ["HCT", ["20570-8", "4544-3"]],
    ["H&H", ["24360-0"]],
    ["MCV", ["787-2"]],
    ["MCH", ["785-6"]],
    ["MCHC", ["786-4"]],
    ["RDW", ["788-0", "21000-5"]],
    ["MPV", ["28542-9", "32623-1"]],
    ["ANC", ["751-8", "26499-4"]],
    ["AGAP", ["33037-3", "10466-1", "1863-0", "41276-7", "73582-9"]],
    ["UACR", ["34535-5", "58447-4", "9318-7"]],
    ["ABG", ["24336-0"]],
    ["VBG", ["24339-4"]],
    ["PCT", ["33959-8", "51637-7"]],
    ["PROCALCITONIN", ["33959-8"]],
    ["HSTNI", ["89579-7"]],
    ["HSTNT", ["67151-1"]],
    ["COVID", ["94500-6", "94531-1"]],
    ["UPEP", ["34539-7"]],
    ["T&S", ["34532-2"]],
    ["XMATCH", ["34531-4"]],
    ["VITD", ["62292-8", "35365-6"]],
    ["QUIGS", ["34550-4"]],
    ["IGG", ["2465-3"]],
    ["IGA", ["2458-8"]],
    ["IGM", ["2472-9"]],
    ["IGE", ["2462-0", "19113-0"]],
    ["HLAB27", ["4821-5", "26028-1", "26043-0"]],
  ] as const)("maps the common mnemonic %s only to its audited code list", (query, expectedCodes) => {
    const response = searchCommonLabOrders({ query, limit: 50, index });
    expect(response.interpretation, query).not.toBeNull();
    expect(response.results.map((result) => result.loincCode), query).toEqual(expectedCodes);
    expect(response.results.every((result) => result.matchReason === "assayindex-interpretation"), query).toBe(true);
  });

  it("requires punctuation or words for collision-prone H&H and T&S shorthand", () => {
    expect(searchCommonLabOrders({ query: "HH", index }).interpretation).toBeNull();
    expect(searchCommonLabOrders({ query: "TS", index }).interpretation).toBeNull();
    expect(searchCommonLabOrders({ query: "H&H", index }).interpretation?.label).toMatch(/hemoglobin and hematocrit/i);
    expect(searchCommonLabOrders({ query: "T&S", index }).interpretation?.label).toMatch(/type and antibody screen/i);
  });

  it("folds case, outer whitespace, and CT/NG punctuation without matching CTNNG", () => {
    const variants = ["CTNG", " ct/ng ", "ct-ng"]
      .map((query) => searchCommonLabOrders({ query, limit: 50, index }).results.map((result) => result.loincCode));
    expect(variants[0]).toEqual(variants[1]);
    expect(variants[1]).toEqual(variants[2]);
    for (const query of ["CTNG", "CT/NG", "CT-NG"]) {
      const response = searchCommonLabOrders({ query, limit: 50, index });
      expect(response.results.some((result) => /CTNNG/i.test(result.matchedTerm))).toBe(false);
    }
  });

  it("does not turn short substrings into broad perfect matches", () => {
    const ua = searchCommonLabOrders({ query: "UA", limit: 50, index });
    const pt = searchCommonLabOrders({ query: "PT", limit: 50, index });
    expect(ua.matchedCount).toBe(4);
    expect(ua.results.map((result) => result.loincCode).toSorted()).toEqual(
      ["24356-8", "58077-9", "57020-0", "24357-6"].toSorted(),
    );
    expect(pt.matchedCount).toBe(1);
    expect(pt.results[0]?.loincCode).toBe("5902-2");
    expect(ua.results.some((result) => /qualitative|quantitative/i.test(result.matchedTerm))).toBe(false);
    expect(pt.results.some((result) => /PTEN/i.test(result.matchedTerm))).toBe(false);
    expect(pt.results.some((result) => /lupus anticoagulant/i.test(result.longCommonName))).toBe(false);
  });

  it("keeps antigen and derived-capacity mnemonics distinct from prefixed terms", () => {
    const hbsAg = searchCommonLabOrders({ query: "HBsAg", limit: 50, index });
    expect(hbsAg.matchedCount).toBeGreaterThan(0);
    expect(hbsAg.results.every((result) => /surface Ag/i.test(result.longCommonName))).toBe(true);
    expect(hbsAg.results.some((result) => /anti.?HBsAg|surface Ab/i.test(result.matchedTerm))).toBe(false);

    const tibc = searchCommonLabOrders({ query: "TIBC", limit: 50, index });
    expect(tibc.matchedCount).toBeGreaterThan(0);
    expect(tibc.results.every((result) => /^TIBC$/i.test(result.matchedTerm))).toBe(true);
    expect(tibc.results.some((result) => /^dTIBC$/i.test(result.matchedTerm))).toBe(false);

    const derivedTibc = searchCommonLabOrders({ query: "dTIBC", limit: 50, index });
    expect(derivedTibc.matchedCount).toBeGreaterThan(0);
    expect(derivedTibc.results.every((result) => /^dTIBC$/i.test(result.matchedTerm))).toBe(true);
  });

  it("keeps RPR distinct from VDRL methods", () => {
    const response = searchCommonLabOrders({ query: "RPR", limit: 50, index });
    expect(response.matchedCount).toBe(2);
    expect(response.results.every((result) => /by RPR/i.test(result.longCommonName))).toBe(true);
    expect(response.results.some((result) => /VDRL/i.test(result.longCommonName))).toBe(false);
  });

  it("keeps T3 and ANA distinct from source-related-name collisions", () => {
    const t3 = searchCommonLabOrders({ query: "T3", limit: 50, index });
    expect(t3.matchedCount).toBe(4);
    expect(t3.results.every((result) => /^Triiodothyronine \(T3\)/i.test(result.longCommonName))).toBe(true);
    expect(t3.results.some((result) => /IgE|Birch/i.test(result.longCommonName))).toBe(false);

    const ana = searchCommonLabOrders({ query: "ANA", limit: 50, index });
    expect(ana.matchedCount).toBe(6);
    expect(ana.results.every((result) => /^Nuclear Ab/i.test(result.longCommonName))).toBe(true);
    expect(ana.results.some((result) => /Epstein|extractable|ribonucleoprotein/i.test(result.longCommonName))).toBe(false);
  });

  it.each([
    ["TSH", /receptor Ab/i],
    ["PSA", /free/i],
    ["PTT", /CRRT|hexagonal/i],
    ["BNP", /prohormone|N.Terminal/i],
    ["TIBC", /unsaturated/i],
    ["PTH", /related protein/i],
  ])("keeps %s distinct from a clinically different neighboring concept", (query, excludedName) => {
    const response = searchCommonLabOrders({ query, limit: 50, index });
    expect(response.matchedCount, query).toBeGreaterThan(0);
    expect(response.results.some((result) => excludedName.test(result.longCommonName))).toBe(false);
  });

  it("bounds public query and result inputs", () => {
    expect(() => normalizeCommonLabOrderQuery("x")).toThrow(/2-120/);
    expect(() => normalizeCommonLabOrderQuery("a b c d e f g h i j k")).toThrow(/1-10/);
    expect(() => normalizeCommonLabOrderLimit(51)).toThrow(/1 through 50/);
    expect(() => normalizeCommonLabOrderLimit("5")).toThrow(/1 through 50/);
    expect(() => normalizeCommonLabOrderLimit(true)).toThrow(/1 through 50/);
  });
});
