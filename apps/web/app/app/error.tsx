"use client";
import { StateMessage } from "../components/ui";
export default function ApplicationError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="centered-state">
      <StateMessage tone="critical" title="Operations shell unavailable">
        The session or airline state could not be refreshed. Sign in again if the issue continues.
      </StateMessage>
      <button className="button button-primary" onClick={reset}>
        Retry
      </button>
      <a href="/sign-in">Sign in again</a>
    </main>
  );
}
