import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type MailpitMessage = Readonly<{
  ID: string;
  Subject: string;
  To: readonly Readonly<{ Address: string }>[];
}>;

async function newestMail(request: APIRequestContext, email: string, subject: string) {
  await expect
    .poll(
      async () => {
        const response = await request.get("http://127.0.0.1:8025/api/v1/messages");
        if (!response.ok()) return false;
        const body = (await response.json()) as { messages: MailpitMessage[] };
        return body.messages.some(
          (message) =>
            message.Subject === subject &&
            message.To.some((recipient) => recipient.Address === email),
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const list = (await (await request.get("http://127.0.0.1:8025/api/v1/messages")).json()) as {
    messages: MailpitMessage[];
  };
  const match = list.messages.find(
    (message) =>
      message.Subject === subject && message.To.some((recipient) => recipient.Address === email),
  );
  if (!match) throw new Error("Expected authentication email was not captured.");
  return (await (await request.get(`http://127.0.0.1:8025/api/v1/message/${match.ID}`)).json()) as {
    Text: string;
  };
}

function actionUrl(message: { Text: string }) {
  const match = message.Text.match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error("Authentication email did not contain an action URL.");
  return match[0];
}

async function registerVerifyAndSignIn(
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
) {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Avery Morgan");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  if (process.env.VISUAL_QA === "1")
    await page.screenshot({ path: "test-results/visual-qa/register-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/verify-email/);
  const verification = await newestMail(request, email, "Verify your Airline Manager email");
  await page.goto(actionUrl(verification));
  await expect(page.getByText("Email verified")).toBeVisible();
  await page.getByRole("link", { name: /Sign in to continue/ }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeDisabled();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/onboarding/);
  if (process.env.VISUAL_QA === "1")
    await page.screenshot({ path: "test-results/visual-qa/onboarding-mobile.png", fullPage: true });
}

async function foundAirline(page: Page, suffix: string, aircraftName: RegExp = /ATR.*72-600/) {
  await page.getByLabel("Airline name").fill(`Meridian Coast ${suffix}`);
  await page.getByRole("textbox", { name: "Tail mark", exact: true }).fill("MC");
  await page.getByRole("checkbox", { name: /This is a fictional airline/ }).check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Home jurisdiction").selectOption("US");
  const search = page.getByLabel("Search airports");
  await search.fill("John F. Kennedy");
  const airport = page.getByRole("option", { name: /^JFK John F\. Kennedy/ });
  await airport.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Selected base")).toBeVisible();
  if (process.env.VISUAL_QA === "1")
    await page.screenshot({ path: "test-results/visual-qa/principal-base-selection-mobile.png" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("US Dollar").click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("Equity only").click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: "Preview runway" }).click();
  await expect(page.getByText("Pre-aircraft runway")).toBeVisible();
  await page.getByRole("button", { name: "Confirm airline" }).click();
  await expect(page.getByRole("heading", { name: "Select the first aircraft" })).toBeVisible();
  if (process.env.VISUAL_QA === "1")
    await page.screenshot({
      path: "test-results/visual-qa/founder-aircraft-comparison-mobile.png",
    });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("tab", { name: aircraftName }).click();
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText("Acceptance schedule")).toBeVisible();
  await page.getByRole("button", { name: "Accept founder lease" }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("heading", { level: 1, name: "Network" })).toBeVisible();
  if (process.env.VISUAL_QA === "1") {
    for (const viewport of [
      { name: "mobile", width: 390, height: 844 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "laptop", width: 1280, height: 800 },
      { name: "desktop", width: 1600, height: 1000 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.screenshot({
        path: `test-results/visual-qa/app-${viewport.name}.png`,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
}

async function exerciseTicket20Planning(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app?view=network");
  await expect(page.getByRole("heading", { name: "Build one defensible route" })).toBeVisible();
  const destination = page.getByLabel("Destination", { exact: true });
  const heathrowValue = await destination
    .locator("option", { hasText: /^LHR/ })
    .getAttribute("value");
  if (!heathrowValue) throw new Error("Published catalog did not expose LHR for range validation.");
  await destination.selectOption(heathrowValue);
  await page.getByRole("button", { name: "Research direct route" }).click();
  await expect(page.getByText("Constraints require recovery")).toBeVisible();
  await expect(page.getByText(/route exceeds the aircraft range/)).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Select an aircraft with more range or choose a shorter route.",
    }),
  ).toHaveAttribute("href", "/app?view=fleet");
  await page.screenshot({ path: "test-results/visual-qa/ticket20-range-constraint-laptop.png" });

  const newarkValue = await destination
    .locator("option", { hasText: /^EWR/ })
    .getAttribute("value");
  if (!newarkValue) throw new Error("Published catalog did not expose EWR for route research.");
  await destination.selectOption(newarkValue);
  await page.getByRole("button", { name: "Research direct route" }).click();
  await expect(page.getByText("Operable direct route")).toBeVisible();
  await expect(page.getByText("Expected profit")).toBeVisible();
  await expect(page.getByRole("table", { name: "Demand segment forecast" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/visual-qa/ticket20-route-research-laptop.png" });

  await page.getByRole("button", { name: "Save researched route" }).click();
  await expect(page.getByText(/Route AM\d+ saved from authoritative research/)).toBeVisible();
  await page.getByRole("button", { name: "Save prospective strategy" }).click();
  await expect(page.getByText(/Pricing strategy v\d+ takes effect/)).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Current and prospective pricing periods" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Refresh +24h forecast" }).click();
  await expect(page.getByRole("table", { name: "Airport weather planning inputs" })).toBeVisible();
  await expect(page.getByText("Generated simulation snapshot, never live weather.")).toBeVisible();

  await page.getByLabel("Leg 2 local departure").fill("08:10");
  await page.getByRole("button", { name: "Validate and activate prospectively" }).click();
  await expect(page.getByText(/Leg 1 is not ready before the following departure/)).toBeVisible();
  await page.getByLabel("Leg 2 local departure").fill("14:00");
  await page.getByLabel("Leg 2 origin").selectOption("JFK");
  await page.getByRole("button", { name: "Validate and activate prospectively" }).click();
  await expect(page.getByText("Planning action blocked")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fleet recovery" })).toHaveAttribute(
    "href",
    "/app?view=fleet",
  );
  await page.getByLabel("Leg 2 origin").selectOption("EWR");
  await page.getByRole("button", { name: "Validate and activate prospectively" }).click();
  await expect(page.getByRole("heading", { name: /Active version 1/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "Generated dated-flight horizon" })).toBeVisible();
  await page.screenshot({ path: "test-results/visual-qa/ticket20-active-rotation-laptop.png" });

  await page.goto("/app?view=fleet");
  await expect(
    page.getByRole("heading", { name: "Aircraft obligations and readiness" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Founder lease" })).toBeVisible();
  await page.screenshot({ path: "test-results/visual-qa/ticket20-fleet-laptop.png" });

  await page.goto("/app?view=fuel");
  await expect(page.getByRole("heading", { name: "Fuel position and purchasing" })).toBeVisible();
  await page.getByLabel("Quantity").fill("1000");
  await page.getByRole("button", { name: "Request expiring quote" }).click();
  const purchaseDialog = page.getByRole("dialog", { name: "Confirm fuel purchase" });
  await expect(purchaseDialog).toBeVisible();
  await expect(purchaseDialog.getByRole("button", { name: "Confirm purchase" })).toBeFocused();
  await purchaseDialog.getByRole("button", { name: "Confirm purchase" }).click();
  await expect(page.getByText(/1,000 kg purchased at the quoted price/)).toBeVisible();
  await page.getByLabel("Planning reserve").fill("500");
  await page.getByRole("button", { name: "Save reserve" }).click();
  await expect(
    page.getByText("Planning reserve updated from the authoritative inventory."),
  ).toBeVisible();
  await page.getByLabel("Projected consumption").fill("1200");
  await page.getByRole("button", { name: "Forecast inventory" }).click();
  await expect(page.getByText("Shortage")).toBeVisible();
  await page.screenshot({ path: "test-results/visual-qa/ticket20-fuel-laptop.png" });

  await page.goto("/app?view=workforce");
  await expect(
    page.getByRole("heading", { name: "Workforce pools and shortage recovery" }),
  ).toBeVisible();
  await expect(page.getByText(/variant:/).first()).toBeVisible();
  await page.getByLabel("Capacity", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Review cost and begin training" }).click();
  await expect(page.getByText(/Capacity enters service .*Hiring .*training/)).toBeVisible();
  await page.screenshot({ path: "test-results/visual-qa/ticket20-workforce-laptop.png" });

  await page.goto("/app?view=maintenance");
  await expect(page.getByRole("heading", { name: "Dispatch readiness" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Aircraft maintenance due counters" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview constraints and schedule" }).click();
  await expect(page.getByText("Maintenance window blocked")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review aircraft rotation occupancy" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/visual-qa/ticket20-maintenance-warning-laptop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app?view=network");
  await expect(page.getByText("Rotation editing requires desktop")).toBeVisible();
  await expect(page.getByLabel("Minimum")).toBeHidden();
  await page.goto("/app?view=fuel");
  await expect(page.getByRole("button", { name: "Request expiring quote" })).toBeVisible();
  await page.goto("/app?view=workforce");
  await expect(page.getByText("Staffing changes require desktop")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review cost and begin training" })).toBeHidden();
  await page.goto("/app?view=maintenance");
  await expect(page.getByText("Maintenance scheduling requires desktop")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview constraints and schedule" })).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "test-results/visual-qa/ticket20-mobile-maintenance-monitoring.png",
    fullPage: true,
  });
}

test.describe.serial("player onboarding", () => {
  test("pending founder delivery keeps monitoring destinations available", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `pending-${stamp}@example.test`;
    await registerVerifyAndSignIn(page, request, email, "Initial-password-2026");
    await foundAirline(page, stamp.slice(-6), /Airbus.*A320neo/);

    await page.goto("/app?view=fleet");
    await expect(
      page.getByRole("heading", { name: "Aircraft obligations and readiness" }),
    ).toBeVisible();
    await expect(page.getByText("Delivery pending")).toBeVisible();
    await expect(page.getByText("Awaiting delivery")).toBeVisible();

    await page.goto("/app?view=maintenance");
    await expect(
      page.getByRole("heading", { name: "Maintenance readiness unavailable" }),
    ).toBeVisible();
    await expect(page.getByText("Maintenance begins after delivery")).toBeVisible();

    for (const [destination, heading] of [
      ["operations", "Flight board"],
      ["finance", "Financial control"],
      ["notifications", "Alerts and notifications"],
    ] as const) {
      await page.goto(`/app?view=${destination}`);
      await expect(page.locator(".application-shell")).toHaveAttribute(
        "data-planning-view",
        destination,
      );
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("mobile registration, verification, keyboard airport selection, founding, lease, and shell recovery", async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `player-${stamp}@example.test`;
    const password = "Initial-password-2026";
    await registerVerifyAndSignIn(page, request, email, password);
    await foundAirline(page, stamp.slice(-6));
    await exerciseTicket20Planning(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/sign-in/);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("Not-the-right-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Sign-in failed")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (process.env.VISUAL_QA === "1")
      await page.screenshot({
        path: "test-results/visual-qa/sign-in-error-mobile.png",
        fullPage: true,
      });
  });

  test("password recovery resets credentials and revokes the old password", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `recovery-${stamp}@example.test`;
    await page.goto("/register");
    await page.getByLabel("Your name").fill("Rowan Ellis");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("Initial-password-2026");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.goto(
      actionUrl(await newestMail(request, email, "Verify your Airline Manager email")),
    );
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    const reset = await newestMail(request, email, "Reset your Airline Manager password");
    await page.goto(actionUrl(reset));
    await page.getByLabel("New password").fill("Replacement-password-2026");
    await page.getByLabel("Confirm password").fill("Replacement-password-2026");
    await page.getByRole("button", { name: "Set new password" }).click();
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("Replacement-password-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/onboarding/);
  });
});
