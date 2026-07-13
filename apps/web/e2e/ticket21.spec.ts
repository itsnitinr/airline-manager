import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1600, height: 1000 },
] as const;

const stableMapStyle = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#06131b" } }],
} as const;

for (const viewport of viewports) {
  for (const view of ["operations", "finance", "notifications"] as const) {
    test(`${view} remains accessible and reflows at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.route("**/__map-style-failure__.json", (route) =>
        route.fulfill({ contentType: "application/json", json: stableMapStyle }),
      );
      await page.goto(`/app/test-harness?view=${view}`);
      await expect(page.locator(".focused-workspace, .operations-desk")).toBeVisible();
      await expect(page.locator('[aria-current="page"]').first()).toContainText(
        view === "notifications" ? "Alerts" : view[0]!.toUpperCase() + view.slice(1),
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `test-results/visual-qa/ticket21-${view}-${viewport.name}-${viewport.width}x${viewport.height}.png`,
        fullPage: viewport.width <= 900,
      });
    });
  }
}

test("exposes ledger statements and reconciliation without hover-only content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/test-harness?view=finance");
  await page.getByRole("button", { name: "Statements" }).click();
  await expect(page.getByText("Ledger and statements reconcile")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profit and loss" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Journal entries" })).toBeVisible();
  await page.screenshot({
    path: "test-results/visual-qa/ticket21-finance-statements-1280x800.png",
  });
});

test("keeps operations recovery and notification preferences keyboard reachable", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addInitScript(() => {
    class GrantedNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: GrantedNotification,
    });
  });
  await page.route("**/__map-style-failure__.json", (route) =>
    route.fulfill({ contentType: "application/json", json: stableMapStyle }),
  );
  await page.goto("/app/test-harness?view=operations");
  await expect(page.getByRole("link", { name: /Fuel suspension/i })).toHaveAttribute(
    "href",
    "/app?view=fuel",
  );
  await page.locator(".operations-filters select").first().focus();
  await expect(page.locator(".operations-filters select").first()).toBeFocused();

  await page.goto("/app/test-harness?view=notifications");
  await expect(page.getByText("Flight MC 021 suspended")).toBeVisible();
  await expect(page.getByLabel("Time zone")).toHaveValue("America/New_York");
  const undersizedTargets = await page
    .locator(".application-shell button, .application-shell select, .application-shell input")
    .evaluateAll((targets) =>
      targets
        .map((target) => ({
          name: target.getAttribute("aria-label") ?? target.textContent?.trim() ?? target.tagName,
          height: target.getBoundingClientRect().height,
        }))
        .filter(({ height }) => height > 0 && height < 44),
    );
  expect(undersizedTargets).toEqual([]);
});
