import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ApplicationError from "./error";
import ApplicationLoading from "./loading";

describe("operations shell route states", () => {
  it("reserves the floating shell geometry while loading", () => {
    const { container } = render(<ApplicationLoading />);
    expect(container.querySelector(".shell-loading")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading navigation" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading airline context" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading network map" })).toBeTruthy();
  });

  it("keeps retry and session recovery actions accessible after an error", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<ApplicationError error={new Error("test failure")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Operations shell unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/sign-in");
  });
});
