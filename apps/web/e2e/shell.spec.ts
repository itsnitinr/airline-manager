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
  sources: {
    boundaries: {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [-80, 35],
                [0, 55],
                [100, 20],
              ],
            },
          },
        ],
      },
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#06131b" } },
    {
      id: "country-boundaries",
      type: "line",
      source: "boundaries",
      paint: { "line-color": "#3b5966", "line-width": 2 },
    },
  ],
} as const;

for (const viewport of viewports) {
  test(`keeps geographic context and planning controls usable at ${viewport.width}x${viewport.height}`, async ({
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
    expect(box!.width).toBeCloseTo(viewport.width, 0);
    if (viewport.width > 900) {
      expect(box!.y).toBeCloseTo(0, 0);
      expect(box!.height).toBeCloseTo(viewport.height, 0);
      await expect(page.locator(".desktop-nav")).toBeVisible();
    } else {
      expect(box!.height).toBeGreaterThanOrEqual(380);
      expect(box!.height).toBeLessThan(viewport.height);
      await expect(
        page.getByRole("navigation", { name: "Mobile planning navigation" }),
      ).toBeVisible();
    }
    await expect(page.locator(".planning-inspector")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Build one defensible route" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results/visual-qa/ticket20-network-${viewport.name}-${viewport.width}x${viewport.height}.png`,
      fullPage: viewport.width <= 900,
    });
  });
}

test("supports keyboard route research and mobile-size action targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/test-harness");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to workspace" })).toBeFocused();
  await page.getByLabel("Destination", { exact: true }).focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Research direct route" }).focus();
  await expect(page.getByRole("button", { name: "Research direct route" })).toBeFocused();

  const undersizedTargets = await page
    .locator(
      ".application-shell .mobile-nav a, .application-shell button, .application-shell select, .application-shell input",
    )
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

test("keeps a loaded external map style beyond the fallback deadline", async ({ page }) => {
  await page.route("**/__map-style-failure__.json", (route) =>
    route.fulfill({ contentType: "application/json", json: stableMapStyle }),
  );
  await page.goto("/app/test-harness?map=degraded");
  const frame = page.locator('[data-map-status="ready"]');
  await expect(frame).toBeVisible();
  await page.waitForTimeout(6_500);
  await expect(frame).toBeVisible();
  await expect(page.getByText(/Base map unavailable/)).toHaveCount(0);
});

test("retains an accessible list equivalent when the map degrades", async ({ page }) => {
  await page.route("**/__map-style-failure__.json", (route) => route.abort("failed"));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/app/test-harness?map=degraded");
  await expect(page.locator('[data-map-status="degraded"] p[role="status"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByLabel("Origin", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Destination", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/visual-qa/ticket20-network-map-degraded.png" });
});

test("uses static motion and opaque planning chrome when requested", async ({ page, context }) => {
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
