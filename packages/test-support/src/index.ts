import type { Clock } from "@airline-manager/domain";

export function createFixedClock(instant: Date): Clock {
  return { now: () => instant };
}
