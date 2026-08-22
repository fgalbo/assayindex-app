import { expect, test } from "@playwright/test";

test("AssayIndex keeps optional server sources separate from the public catalog", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  const requestFailures: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.failure()?.errorText ?? "request failed"} ${request.url()}`);
  });

  await page.goto("/assayindex", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/AssayIndex/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Find rare tests across reference laboratories" }),
  ).toBeVisible();
  await expect(page.getByText("Testing phase")).toBeVisible();
  await expect(page.getByText("Recent additions")).toHaveCount(0);
  await expect(page.getByText("Featured assays")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Catalog" })).toHaveCount(0);

  await page.goto("/assayindex/search?q=TP53", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 2, name: "Verified AssayIndex records" })).toBeVisible();
  await expect(page.getByText(/No verified catalog record matched this query/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "NIH Genetic Testing Registry" })).toBeVisible();
  await expect(page.getByText(/validated GTR testing index is temporarily unavailable/i)).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/assayindex/search?q=UDS", { waitUntil: "domcontentloaded" });
  const terminologyRegion = page.getByRole("region", { name: "Common laboratory order terminology" });
  await expect(terminologyRegion.getByText(/interpreted in the laboratory-order context as/i)).toContainText(
    "Urine drug screen",
  );
  await expect(terminologyRegion.getByRole("heading", { name: /Drugs of abuse 5 panel.*Urine/i })).toBeVisible();
  await expect(terminologyRegion.getByText(/query is not sent to NLM/i)).toBeVisible();

  await page.goto("/assayindex/search?q=CTNG", { waitUntil: "domcontentloaded" });
  const ctngTerminologyRegion = page.getByRole("region", { name: "Common laboratory order terminology" });
  await expect(ctngTerminologyRegion.getByText(/interpreted in the laboratory-order context as/i)).toContainText(
    "Combined Chlamydia trachomatis / Neisseria gonorrhoeae testing",
  );

  await page.goto("/assayindex/search?q=MCV", { waitUntil: "domcontentloaded" });
  const mcvTerminologyRegion = page.getByRole("region", { name: "Common laboratory order terminology" });
  await expect(mcvTerminologyRegion.getByRole("heading", { name: /MCV.*Red Blood Cells/i })).toBeVisible();
  await expect(mcvTerminologyRegion.getByText("Audited mnemonic supplement", { exact: true })).toBeVisible();
  await expect(mcvTerminologyRegion.getByText("Order role not classified by source")).toBeVisible();

  await page.goto("/assayindex/search?q=HLA-B27", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("option", { name: /HLA-B27 Association Testing/ })).toBeVisible();
  await page.getByRole("button", { name: "Search current laboratory directories" }).click();
  const arupRegion = page.getByRole("region", { name: "ARUP Laboratories" });
  await expect(arupRegion).toContainText("permission required", { timeout: 30_000 });
  await expect(arupRegion.getByRole("link", { name: "Open official test directory" })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) =>
      !message.includes("503 (Service Unavailable)")
      && !message.startsWith("Failed to load resource:")),
    `HTTP errors: ${httpErrors.join(" | ")}`,
  ).toEqual([]);
  expect(requestFailures).toEqual([]);
  expect(
    httpErrors.filter((message) =>
      !/^503 https?:\/\/[^/]+\/api\/assayindex\/testing-search$/.test(message)),
  ).toEqual([]);
});
