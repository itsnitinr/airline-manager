export function readOptionalString(name: string, environment = process.env): string | undefined {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}

export function readOptionalInteger(name: string, environment = process.env): number | undefined {
  const value = readOptionalString(name, environment);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || `${parsed}` !== value) {
    throw new Error(`${name} must be an integer.`);
  }
  return parsed;
}
