import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1600, height: 1000 },
] as const;

for (const viewport of viewports) {
  test(`keeps the network map full bleed at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/app/test-harness");
    const map = page.getByTestId("airport-map");
    await expect(map).toHaveAttribute("data-presentation", "shell");
    await expect(page.getByTestId("airport-map-canvas")).toBeVisible();
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(0, 0);
    expect(box!.y).toBeCloseTo(0, 0);
    expect(box!.width).toBeCloseTo(viewport.width, 0);
    expect(box!.height).toBeCloseTo(viewport.height, 0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const inspector = page.getByRole("complementary", { name: "Network inspector" });
    if (viewport.width <= 900) await expect(inspector).toBeHidden();
    else await expect(inspector).toBeVisible();

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results/visual-qa/shell-${viewport.name}-${viewport.width}x${viewport.height}.png`,
    });
  });
}

test("opens and closes the mobile context sheet with keyboard-safe controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/test-harness");
  const openButton = page.getByRole("button", { name: /Network ready/ });
  await openButton.click();
  const inspector = page.getByRole("complementary", { name: "Network inspector" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText("dispatcher@example.test")).toBeVisible();
  await page.screenshot({ path: "test-results/visual-qa/shell-mobile-sheet-open.png" });
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  await expect(page.getByRole("button", { name: "Open inspector" })).toBeFocused();

  for (const target of await page
    .locator(".mobile-nav a, .mobile-nav button, .context-tray button, .inspector-toggle")
    .all()) {
    const targetBox = await target.boundingBox();
    expect(targetBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("shows pending and degraded authoritative states without adding planner UI", async ({
  page,
}) => {
  await page.route("**/__map-style-failure__.json", (route) => route.abort("failed"));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/test-harness?state=pending&map=degraded");
  await expect(page.getByText("Aircraft delivery pending")).toBeVisible();
  await expect(page.locator('[data-map-status="degraded"] p[role="status"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /Open route planner/ })).toBeDisabled();
  await page.screenshot({ path: "test-results/visual-qa/shell-pending-map-degraded.png" });

  await page.getByRole("button", { name: "Minimize inspector" }).click();
  await expect(page.getByRole("complementary", { name: "Network inspector" })).toBeHidden();
  await page.screenshot({ path: "test-results/visual-qa/shell-inspector-collapsed.png" });
});

test("uses static motion and an opaque chrome fallback when requested", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  await page.goto("/app/test-harness");
  const chrome = page.locator(".workspace-header");
  await expect(chrome).toBeVisible();
  expect(await chrome.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe("none");
  expect(
    await chrome.evaluate((element) =>
      getComputedStyle(element).transitionDuration.endsWith("ms")
        ? Number.parseFloat(getComputedStyle(element).transitionDuration)
        : Number.parseFloat(getComputedStyle(element).transitionDuration) * 1000,
    ),
  ).toBeLessThanOrEqual(0.001);
});
