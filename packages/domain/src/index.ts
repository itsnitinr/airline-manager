export type Clock = Readonly<{
  now: () => Date;
}>;

export function readCurrentTime(clock: Clock): Date {
  return clock.now();
}
