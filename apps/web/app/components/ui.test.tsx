import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, ProvenanceLabel, StateMessage } from "./ui";

describe("design system semantics", () => {
  it("keeps labels, hints, validation, and status meaning explicit", () => {
    render(
      <>
        <Field
          htmlFor="airline"
          label="Airline name"
          hint="Use a fictional identity."
          error="Name is unavailable."
        >
          <input id="airline" />
        </Field>
        <StateMessage tone="critical" title="Action required">
          Recover the session.
        </StateMessage>
        <ProvenanceLabel classification="derived" />
      </>,
    );
    const field = screen.getByLabelText("Airline name");
    expect(field.getAttribute("aria-describedby")).toBe("airline-hint airline-error");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Action required").closest("[role=alert]")).toBeTruthy();
    expect(screen.getByText("Derived forecast").getAttribute("data-classification")).toBe(
      "derived",
    );
  });
});
