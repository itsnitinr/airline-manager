export function formatMoney(minor: string, currency: string, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(Number(minor) / 100);
}

export function formatDateTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
}

export function formatPercent(basisPoints: number | string) {
  return `${(Number(basisPoints) / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function formatMass(kilograms: string) {
  return `${Number(kilograms).toLocaleString()} kg`;
}

export function formatDuration(minutes: number | string) {
  const value = Number(minutes);
  const hours = Math.floor(value / 60);
  const remaining = value % 60;
  return hours > 0 ? `${hours}h ${remaining}m` : `${remaining}m`;
}

export function nextLocalDate(days = 1) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
