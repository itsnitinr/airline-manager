"use client";

import { GoogleLogo, SpinnerGap } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authApi, WebApiError } from "../lib/client-api";
import { Button, Field, StateMessage } from "./ui";

function submitError(error: unknown) {
  return error instanceof WebApiError
    ? error.actionable
    : {
        code: "unknown",
        message: "The request could not be completed. Try again.",
        fields: {},
        recoverable: true,
      };
}

function PendingLabel({ pending, children }: { pending: boolean; children: string }) {
  return pending ? (
    <>
      <SpinnerGap aria-hidden size={18} className="spin" />
      Working
    </>
  ) : (
    children
  );
}

export function RegistrationForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReturnType<typeof submitError> | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    try {
      await authApi.register({
        name: String(data.get("name") ?? "").trim(),
        email,
        password: String(data.get("password") ?? ""),
        callbackURL: `${window.location.origin}/verify-email?verified=1`,
      });
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (caught) {
      setError(submitError(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit} noValidate>
      {error ? (
        <StateMessage tone="critical" title="Registration not completed">
          {error.message}
        </StateMessage>
      ) : null}
      <Field htmlFor="name" label="Your name" error={error?.fields.name}>
        <input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          aria-invalid={Boolean(error?.fields.name)}
        />
      </Field>
      <Field htmlFor="email" label="Email address" error={error?.fields.email}>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(error?.fields.email)}
        />
      </Field>
      <Field
        htmlFor="password"
        label="Password"
        hint="Use at least 12 characters."
        error={error?.fields.password}
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby="password-hint"
          aria-invalid={Boolean(error?.fields.password)}
        />
      </Field>
      <Button className="button-primary" disabled={pending}>
        <PendingLabel pending={pending}>Create account</PendingLabel>
      </Button>
    </form>
  );
}

export function SignInForm({
  returnTo,
  googleAvailable,
}: {
  returnTo: string;
  googleAvailable: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<ReturnType<typeof submitError> | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await authApi.signIn({
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        callbackURL: `${window.location.origin}${returnTo}`,
      });
      router.push(returnTo);
      router.refresh();
    } catch (caught) {
      setError(submitError(caught));
    } finally {
      setPending(false);
    }
  }
  async function google() {
    setGooglePending(true);
    setError(null);
    try {
      const result = await authApi.google({
        callbackURL: `${window.location.origin}${returnTo}`,
        errorCallbackURL: `${window.location.origin}/sign-in?provider=google`,
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(submitError(caught));
      setGooglePending(false);
    }
  }
  return (
    <>
      <form className="form-stack" onSubmit={submit} noValidate>
        {error ? (
          <StateMessage
            tone={error.code === "EMAIL_NOT_VERIFIED" ? "warning" : "critical"}
            title={error.code === "EMAIL_NOT_VERIFIED" ? "Verification required" : "Sign-in failed"}
          >
            {error.message}
          </StateMessage>
        ) : null}
        <Field htmlFor="email" label="Email address">
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
          />
        </Field>
        <Field htmlFor="password" label="Password">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <div className="form-inline">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        <Button className="button-primary" disabled={pending || googlePending}>
          <PendingLabel pending={pending}>Sign in</PendingLabel>
        </Button>
      </form>
      <div className="auth-divider">
        <span>or</span>
      </div>
      <Button
        className="button-secondary"
        type="button"
        disabled={!googleAvailable || pending || googlePending}
        onClick={google}
        aria-describedby={!googleAvailable ? "google-unavailable" : undefined}
      >
        <GoogleLogo aria-hidden size={20} weight="bold" />
        <PendingLabel pending={googlePending}>Continue with Google</PendingLabel>
      </Button>
      {!googleAvailable ? (
        <p id="google-unavailable" className="field-hint">
          Google sign-in is not configured here. Use email and password.
        </p>
      ) : null}
    </>
  );
}

export function VerificationForm({ email, verified }: { email: string; verified: boolean }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await authApi.resendVerification({
        email: String(data.get("email") ?? "").trim(),
        callbackURL: `${window.location.origin}/verify-email?verified=1`,
      });
      setSent(true);
    } catch (caught) {
      setError(submitError(caught).message);
    } finally {
      setPending(false);
    }
  }
  if (verified)
    return (
      <StateMessage tone="nominal" title="Email verified">
        Your account is ready. <Link href="/sign-in">Sign in to continue</Link>.
      </StateMessage>
    );
  return (
    <form className="form-stack" onSubmit={resend}>
      <StateMessage
        tone={sent ? "nominal" : "neutral"}
        title={sent ? "Verification sent" : "Check your inbox"}
      >
        {sent
          ? "Use the newest link we sent. It expires after one hour."
          : "Open the verification link before signing in."}
      </StateMessage>
      {error ? (
        <StateMessage tone="critical" title="Message not sent">
          {error}
        </StateMessage>
      ) : null}
      <Field htmlFor="email" label="Email address">
        <input id="email" name="email" type="email" defaultValue={email} required />
      </Field>
      <Button className="button-secondary" disabled={pending}>
        <PendingLabel pending={pending}>Send another link</PendingLabel>
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await authApi.requestReset({
        email: String(data.get("email") ?? "").trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setSent(true);
    } catch (caught) {
      setError(submitError(caught).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {sent ? (
        <StateMessage tone="nominal" title="Check your inbox">
          If an account exists, a reset link is on its way.
        </StateMessage>
      ) : null}
      {error ? (
        <StateMessage tone="critical" title="Request failed">
          {error}
        </StateMessage>
      ) : null}
      <Field htmlFor="email" label="Email address">
        <input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button className="button-primary" disabled={pending}>
        <PendingLabel pending={pending}>Send reset link</PendingLabel>
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "This reset link is missing its token.",
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const first = String(data.get("password") ?? "");
    const second = String(data.get("confirmPassword") ?? "");
    if (first !== second) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }
    try {
      await authApi.resetPassword({ newPassword: first, token });
      router.push("/sign-in?reset=1");
    } catch (caught) {
      setError(submitError(caught).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {error ? (
        <StateMessage tone="critical" title="Password not reset">
          {error}
        </StateMessage>
      ) : null}
      <Field htmlFor="password" label="New password" hint="Use at least 12 characters.">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby="password-hint"
        />
      </Field>
      <Field htmlFor="confirmPassword" label="Confirm password">
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      <Button className="button-primary" disabled={pending || !token}>
        <PendingLabel pending={pending}>Set new password</PendingLabel>
      </Button>
    </form>
  );
}
