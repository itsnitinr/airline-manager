import type {
  AcceptFounderLeaseResponse,
  ConfirmAirlineFoundingResponse,
  ErrorEnvelope,
  FoundingSelectionRequest,
  GetAirlineCareerSummaryResponse,
  ListFleetResponse,
  ListFounderPackageResponse,
  PreviewAirlineFoundingResponse,
  PreviewFounderLeaseResponse,
} from "@airline-manager/contracts";

export type AuthErrorBody = Readonly<{ code?: string; message?: string }>;
export type ActionableError = Readonly<{
  code: string;
  message: string;
  fields: Readonly<Record<string, string>>;
  recoverable: boolean;
}>;

const SAFE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email or password is incorrect.",
  EMAIL_NOT_VERIFIED: "Verify your email before signing in.",
  PROVIDER_NOT_FOUND: "Google sign-in is not available in this environment.",
  USER_ALREADY_EXISTS: "An account with this email may already exist. Try signing in.",
  INVALID_TOKEN: "This link is invalid or has expired. Request a new one.",
  authentication_required: "Your session has expired. Sign in and try again.",
  verified_account_required: "Verify your email before continuing.",
  idempotency_conflict: "This request changed after it was started. Review it and try again.",
  active_airline_exists: "An active airline already exists for this account.",
  airline_name_unavailable: "That airline name is unavailable. Choose another name.",
  airport_jurisdiction_mismatch: "Choose a principal base in the selected jurisdiction.",
  founder_lease_already_accepted: "A founder aircraft has already been selected.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
};

function isEnvelope(value: unknown): value is ErrorEnvelope {
  return Boolean(
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as ErrorEnvelope).error?.code === "string",
  );
}

export function mapApiError(status: number, value: unknown): ActionableError {
  const envelope = isEnvelope(value) ? value.error : undefined;
  const auth = value && typeof value === "object" ? (value as AuthErrorBody) : undefined;
  const code = envelope?.code ?? auth?.code ?? `request_failed_${status}`;
  const fields = Object.fromEntries(
    (envelope?.details ?? [])
      .filter((detail) => detail.field)
      .map((detail) => [detail.field!.replace(/^\//, ""), detail.issue]),
  );
  return {
    code,
    fields,
    message:
      SAFE_MESSAGES[code] ??
      (status >= 500
        ? "The service could not complete the request. Your entries are still here."
        : "Review the highlighted information and try again."),
    recoverable:
      status === 401 || status === 408 || status === 409 || status === 429 || status >= 500,
  };
}

export class WebApiError extends Error {
  public constructor(
    readonly status: number,
    readonly actionable: ActionableError,
  ) {
    super(actionable.message);
    this.name = "WebApiError";
  }
}

export async function browserFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/backend${path}`, {
    ...init,
    credentials: "include",
    headers: { accept: "application/json", ...init.headers },
  });
  const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) throw new WebApiError(response.status, mapApiError(response.status, body));
  return body as T;
}

export const authApi = {
  register: (body: { name: string; email: string; password: string; callbackURL: string }) =>
    browserFetch<{ user: { email: string } }>("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  signIn: (body: { email: string; password: string; callbackURL: string }) =>
    browserFetch<{ redirect: boolean; url?: string; user: { emailVerified: boolean } }>(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  signOut: () => browserFetch<{ success: boolean }>("/api/auth/sign-out", { method: "POST" }),
  resendVerification: (body: { email: string; callbackURL: string }) =>
    browserFetch<{ status: boolean }>("/api/auth/send-verification-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  requestReset: (body: { email: string; redirectTo: string }) =>
    browserFetch<{ status: boolean }>("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  resetPassword: (body: { newPassword: string; token: string }) =>
    browserFetch<{ status: boolean }>("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  google: (body: { callbackURL: string; errorCallbackURL: string }) =>
    browserFetch<{ url: string; redirect: boolean }>("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", ...body, disableRedirect: true }),
    }),
};

export const careerApi = {
  summary: (airlineId: string) =>
    browserFetch<GetAirlineCareerSummaryResponse>(`/v1/airlines/${encodeURIComponent(airlineId)}`),
  previewFounding: (selection: FoundingSelectionRequest) =>
    browserFetch<PreviewAirlineFoundingResponse>("/v1/airlines/founding/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selection),
    }),
  confirmFounding: (selection: FoundingSelectionRequest, idempotencyKey: string) =>
    browserFetch<ConfirmAirlineFoundingResponse>("/v1/airlines/founding/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(selection),
    }),
  founderPackage: (airlineId: string) =>
    browserFetch<ListFounderPackageResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/founder-package`,
    ),
  previewLease: (airlineId: string, optionCode: string) =>
    browserFetch<PreviewFounderLeaseResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/founder-package/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optionCode }),
      },
    ),
  acceptLease: (airlineId: string, optionCode: string, idempotencyKey: string) =>
    browserFetch<AcceptFounderLeaseResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/founder-lease/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ optionCode }),
      },
    ),
  fleet: (airlineId: string) =>
    browserFetch<ListFleetResponse>(`/v1/airlines/${encodeURIComponent(airlineId)}/fleet`),
};

export function createStableIdempotencyKey(
  storageKey: string,
  fingerprint: string,
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
): string {
  const existing = storage.getItem(storageKey);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { fingerprint: string; key: string };
      if (parsed.fingerprint === fingerprint && parsed.key) return parsed.key;
    } catch {
      // Invalid local state is safely replaced below.
    }
  }
  const key = crypto.randomUUID();
  storage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
  return key;
}
