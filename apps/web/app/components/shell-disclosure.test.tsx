import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ShellDisclosure } from "./shell-disclosure";

const storageKey = "airline-manager:shell-inspector:v1";

function renderDisclosure() {
  return render(
    <ShellDisclosure
      mobileUtilities={<button type="button">Sign out</button>}
      trayTitle="Network ready"
      trayDetail="ATR 72-600 · LHR"
    >
      <p>Authoritative network context</p>
    </ShellDisclosure>,
  );
}

describe("shell inspector disclosure", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists an explicit desktop collapse and restores focus on Escape", async () => {
    const user = userEvent.setup();
    renderDisclosure();
    const trigger = screen.getByRole("button", { name: "Minimize inspector" });
    await user.click(trigger);
    expect(window.localStorage.getItem(storageKey)).toBe("closed");
    expect(screen.queryByRole("complementary", { name: "Network inspector" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Network ready/ }));
    expect(screen.getByRole("complementary", { name: "Network inspector" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("complementary", { name: "Network inspector" })).toBeNull();
  });

  it("safely restores the versioned collapsed preference", async () => {
    window.localStorage.setItem(storageKey, "closed");
    renderDisclosure();
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Network inspector" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Open inspector" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
