import { describe, expect, it, vi } from "vitest";
import {
  SmtpAuthenticationEmailDelivery,
  readSmtpAuthenticationEmailOptions,
  type AuthenticationMailTransportFactory,
  type SmtpAuthenticationEmailOptions,
} from "./smtp-email.js";

const options: SmtpAuthenticationEmailOptions = {
  host: "mailpit",
  port: 1025,
  secure: false,
  from: "Airline Manager <no-reply@airline-manager.test>",
};

function fixture(overrides: Partial<SmtpAuthenticationEmailOptions> = {}) {
  const sendMail = vi.fn(async () => ({ accepted: ["player@example.test"] }));
  const createTransport = vi.fn<AuthenticationMailTransportFactory>(() => ({ sendMail }));
  const delivery = new SmtpAuthenticationEmailDelivery(
    { ...options, ...overrides },
    createTransport,
  );
  return { createTransport, delivery, sendMail };
}

describe("SMTP authentication email delivery", () => {
  it("reads explicit public-safe SMTP configuration", () => {
    expect(
      readSmtpAuthenticationEmailOptions({
        AUTH_EMAIL_SMTP_HOST: "mailpit",
        AUTH_EMAIL_SMTP_PORT: "1025",
        AUTH_EMAIL_SMTP_SECURE: "false",
        AUTH_EMAIL_FROM: "Airline Manager <no-reply@airline-manager.test>",
      }),
    ).toEqual(options);
    expect(() =>
      readSmtpAuthenticationEmailOptions({
        AUTH_EMAIL_SMTP_HOST: "mailpit",
        AUTH_EMAIL_SMTP_PORT: "1025",
        AUTH_EMAIL_SMTP_SECURE: "sometimes",
        AUTH_EMAIL_FROM: "no-reply@example.test",
      }),
    ).toThrow("must be true or false");
  });

  it("creates an unauthenticated local SMTP transport and sends verification mail", async () => {
    const { createTransport, delivery, sendMail } = fixture();
    await delivery.send({
      kind: "email_verification",
      to: "player@example.test",
      actionUrl: "http://localhost:3001/api/auth/verify-email?token=verification-secret",
    });

    expect(createTransport).toHaveBeenCalledWith({ host: "mailpit", port: 1025, secure: false });
    expect(sendMail).toHaveBeenCalledWith({
      from: options.from,
      to: "player@example.test",
      subject: "Verify your Airline Manager email",
      text: expect.stringContaining(
        "http://localhost:3001/api/auth/verify-email?token=verification-secret",
      ),
    });
  });

  it("passes paired SMTP credentials and sends password recovery mail", async () => {
    const { createTransport, delivery, sendMail } = fixture({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      username: "mailer",
      password: "private-password",
    });
    await delivery.send({
      kind: "password_reset",
      to: "player@example.test",
      actionUrl: "https://api.example.test/api/auth/reset-password/reset-secret",
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      auth: { user: "mailer", pass: "private-password" },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Reset your Airline Manager password",
        text: expect.stringContaining("reset-secret"),
      }),
    );
  });

  it("rejects unsafe partial credentials and propagates delivery failures", async () => {
    expect(() => fixture({ username: "mailer" })).toThrow("must be configured together");

    const failure = new Error("SMTP unavailable");
    const createTransport: AuthenticationMailTransportFactory = () => ({
      sendMail: vi.fn(async () => Promise.reject(failure)),
    });
    const delivery = new SmtpAuthenticationEmailDelivery(options, createTransport);
    await expect(
      delivery.send({
        kind: "password_reset",
        to: "player@example.test",
        actionUrl: "http://localhost:3001/api/auth/reset-password/reset-secret",
      }),
    ).rejects.toBe(failure);
  });
});
