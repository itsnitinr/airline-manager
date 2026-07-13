import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("falls back without tiles and keeps airport selection keyboard accessible", async ({
  page,
}) => {
  await page.route("**/__map-style-failure__.json", (route) => route.abort("failed"));
  await page.goto("/map/test-harness");

  const airportSelect = page.getByLabel("Select airport");
  await expect(airportSelect).toBeVisible();
  await airportSelect.focus();
  await page.keyboard.press("End");
  await expect(page.getByText("Selected airport: catalog-sin")).toBeVisible();
  await expect(page.locator('[data-map-status="degraded"] p[role="status"]')).toBeVisible({
    timeout: 10_000,
  });

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
