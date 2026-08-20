import { expect, test } from "@playwright/test";

test("AssayIndex keeps optional server sources separate from the public catalog", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
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

  await page.goto("/assayindex/search?q=HLA-B27", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("option", { name: /HLA-B27 Association Testing/ })).toBeVisible();
  await page.getByRole("button", { name: "Search current laboratory directories" }).click();
  const arupRegion = page.getByRole("region", { name: "ARUP Laboratories" });
  await expect(arupRegion).toContainText("permission required", { timeout: 30_000 });
  await expect(arupRegion.getByRole("link", { name: "Open official test directory" })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("503 (Service Unavailable)"))).toEqual([]);
});
