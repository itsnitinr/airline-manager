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

async function foundAirline(page: Page, suffix: string) {
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
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("US Dollar").click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("Equity only").click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: "Preview runway" }).click();
  await expect(page.getByText("Pre-aircraft runway")).toBeVisible();
  await page.getByRole("button", { name: "Confirm airline" }).click();
  await expect(page.getByRole("heading", { name: "Select the first aircraft" })).toBeVisible();
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText("Acceptance schedule")).toBeVisible();
  await page.getByRole("button", { name: "Accept founder lease" }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(
    page.getByRole("heading", { name: new RegExp(`Meridian Coast ${suffix}`) }),
  ).toBeVisible();
  if (process.env.VISUAL_QA === "1") {
    for (const viewport of [
      { name: "mobile", width: 390, height: 844 },
      { name: "laptop", width: 1280, height: 800 },
      { name: "desktop", width: 1600, height: 1000 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.screenshot({
        path: `test-results/visual-qa/app-${viewport.name}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
}

test.describe.serial("player onboarding", () => {
  test("mobile registration, verification, keyboard airport selection, founding, lease, and shell recovery", async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `player-${stamp}@example.test`;
    const password = "Initial-password-2026";
    await registerVerifyAndSignIn(page, request, email, password);
    await foundAirline(page, stamp.slice(-6));
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/sign-in/);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("Not-the-right-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Sign-in failed")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue(email);
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
