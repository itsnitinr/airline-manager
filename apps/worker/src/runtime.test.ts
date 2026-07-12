import { describe, expect, it } from "vitest";
import { RuntimeMetrics } from "./runtime.js";

describe("worker runtime observability", () => {
  it("reports bounded low-cardinality outcomes, lag, drain, and active work", () => {
    const metrics = new RuntimeMetrics();
    metrics.increment("published", 2);
    metrics.increment("handlerNoops");
    metrics.lag = {
      outbox: 3,
      milestones: 4,
      outboxLagSeconds: 5,
      milestoneLagSeconds: 6,
      failures: 1,
    };
    const rendered = metrics.render(true, 2);
    expect(rendered).toContain('airline_worker_events_total{outcome="published"} 2');
    expect(rendered).toContain("airline_worker_milestone_lag_seconds 6");
    expect(rendered).toContain("airline_worker_draining 1");
    expect(rendered).toContain("airline_worker_active_jobs 2");
    expect(rendered).not.toContain("commandId");
  });
});
