import type { FastifyInstance } from "fastify";
import { createApiServer } from "./app.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

export async function createOpenApiDocument(
  createApp: () => FastifyInstance = () => createApiServer({ logger: false }),
): Promise<string> {
  const app = createApp();
  try {
    await app.ready();
    const document = app.swagger() as unknown as JsonValue;
    return `${JSON.stringify(sortJson(document), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
