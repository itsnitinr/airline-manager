import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "./auth-forms";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("authentication forms", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("preserves entries when the server rejects sign-in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "internal" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const user = userEvent.setup();
    render(<SignInForm returnTo="/onboarding" googleAvailable={false} />);
    await user.type(screen.getByLabelText("Email address"), "pilot@example.test");
    await user.type(screen.getByLabelText("Password"), "not-the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email or password is incorrect.")).toBeTruthy();
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe(
      "pilot@example.test",
    );
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeDisabled();
  });
});
