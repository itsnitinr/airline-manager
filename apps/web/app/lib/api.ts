import type {
  GetCurrentPlayerCareerResponse,
  GetPublicConfigResponse,
  GetPublishedCatalogResponse,
} from "@airline-manager/contracts";
import { headers } from "next/headers";

export type PublicCatalog = GetPublishedCatalogResponse;
export type CurrentCareer = GetCurrentPlayerCareerResponse;
export type PublicConfig = GetPublicConfigResponse;

export type AuthSession = Readonly<{
  session: Readonly<{
    userId: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
  }>;
  user: Readonly<{
    id: string;
    email: string;
    name: string;
    image?: string | null;
    emailVerified: boolean;
  }>;
}>;

const serverApiUrl = () =>
  (
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:3001"
  ).replace(/\/$/, "");

export async function serverApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const incoming = await headers();
  const cookie = incoming.get("cookie");
  const requestHeaders = new Headers(init.headers);
  if (cookie) requestHeaders.set("cookie", cookie);
  requestHeaders.set("accept", "application/json");
  const response = await fetch(`${serverApiUrl()}${path}`, {
    ...init,
    headers: requestHeaders,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`server_api_${response.status}`);
  return (await response.json()) as T;
}

export async function getSession(): Promise<AuthSession | null> {
  try {
    return await serverApiFetch<AuthSession | null>("/api/auth/get-session");
  } catch {
    return null;
  }
}

export async function getCurrentCareer(): Promise<CurrentCareer> {
  return serverApiFetch<CurrentCareer>("/v1/player/career");
}

export async function getPublishedCatalog(): Promise<PublicCatalog> {
  return serverApiFetch<PublicCatalog>("/v1/catalog/current");
}

export async function getPublicConfig(): Promise<PublicConfig> {
  return serverApiFetch<PublicConfig>("/v1/public/config");
}

export function safeReturnPath(value: string | string[] | undefined, fallback = "/") {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : fallback;
}
