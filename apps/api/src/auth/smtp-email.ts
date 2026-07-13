import {
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
} from "@airline-manager/config";
import { createTransport } from "nodemailer";
import type { AuthenticationEmail, AuthenticationEmailDelivery } from "./email.js";

export type SmtpAuthenticationEmailOptions = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username?: string;
  password?: string;
}>;

export type AuthenticationMail = Readonly<{
  from: string;
  to: string;
  subject: string;
  text: string;
}>;

export interface AuthenticationMailTransport {
  sendMail(message: AuthenticationMail): Promise<unknown>;
}

export type AuthenticationMailTransportFactory = (
  configuration: Readonly<{
    host: string;
    port: number;
    secure: boolean;
    auth?: Readonly<{ user: string; pass: string }>;
  }>,
) => AuthenticationMailTransport;

const nodemailerTransport: AuthenticationMailTransportFactory = (configuration) =>
  createTransport(configuration);

function validateOptions(options: SmtpAuthenticationEmailOptions): void {
  if (!options.host.trim()) throw new Error("Authentication SMTP host is required.");
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("Authentication SMTP port must be an integer from 1 to 65535.");
  }
  if (!options.from.trim()) throw new Error("Authentication email sender is required.");
  if ((options.username && !options.password) || (!options.username && options.password)) {
    throw new Error("Authentication SMTP username and password must be configured together.");
  }
}

export function readSmtpAuthenticationEmailOptions(
  environment: NodeJS.ProcessEnv = process.env,
): SmtpAuthenticationEmailOptions {
  const port = readOptionalInteger("AUTH_EMAIL_SMTP_PORT", environment);
  if (port === undefined) throw new Error("AUTH_EMAIL_SMTP_PORT is required.");
  const secureValue = readRequiredString("AUTH_EMAIL_SMTP_SECURE", environment);
  if (secureValue !== "true" && secureValue !== "false") {
    throw new Error("AUTH_EMAIL_SMTP_SECURE must be true or false.");
  }
  const username = readOptionalString("AUTH_EMAIL_SMTP_USERNAME", environment);
  const password = readOptionalString("AUTH_EMAIL_SMTP_PASSWORD", environment);
  const options: SmtpAuthenticationEmailOptions = {
    host: readRequiredString("AUTH_EMAIL_SMTP_HOST", environment),
    port,
    secure: secureValue === "true",
    from: readRequiredString("AUTH_EMAIL_FROM", environment),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
  validateOptions(options);
  return options;
}

function content(message: AuthenticationEmail): Readonly<{ subject: string; text: string }> {
  if (message.kind === "email_verification") {
    return {
      subject: "Verify your Airline Manager email",
      text: [
        "Verify your email to activate your Airline Manager account.",
        "",
        message.actionUrl,
        "",
        "This link expires in one hour. If you did not create this account, ignore this email.",
      ].join("\n"),
    };
  }
  return {
    subject: "Reset your Airline Manager password",
    text: [
      "Use this link to reset your Airline Manager password.",
      "",
      message.actionUrl,
      "",
      "This link expires in one hour. If you did not request a reset, ignore this email.",
    ].join("\n"),
  };
}

export class SmtpAuthenticationEmailDelivery implements AuthenticationEmailDelivery {
  private readonly transport: AuthenticationMailTransport;

  public constructor(
    private readonly options: SmtpAuthenticationEmailOptions,
    createMailTransport: AuthenticationMailTransportFactory = nodemailerTransport,
  ) {
    validateOptions(options);
    const authenticated = options.username && options.password;
    this.transport = createMailTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(authenticated ? { auth: { user: options.username, pass: options.password } } : {}),
    });
  }

  public async send(message: AuthenticationEmail): Promise<void> {
    const rendered = content(message);
    await this.transport.sendMail({
      from: this.options.from,
      to: message.to,
      subject: rendered.subject,
      text: rendered.text,
    });
  }
}
