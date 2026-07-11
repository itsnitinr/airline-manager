export type AuthenticationEmail = Readonly<{
  kind: "email_verification" | "password_reset";
  to: string;
  actionUrl: string;
}>;

export interface AuthenticationEmailDelivery {
  send(message: AuthenticationEmail): Promise<void>;
}

/** Deterministic, process-local delivery for development and tests; never logs URLs or tokens. */
export class CapturingAuthenticationEmailDelivery implements AuthenticationEmailDelivery {
  readonly messages: AuthenticationEmail[] = [];

  async send(message: AuthenticationEmail): Promise<void> {
    this.messages.push({ ...message });
  }

  clear(): void {
    this.messages.length = 0;
  }
}
