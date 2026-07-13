import Link from "next/link";
import { AuthFrame } from "../components/auth-frame";
import { SignInForm } from "../components/auth-forms";
import { getPublicConfig, safeReturnPath } from "../lib/api";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnPath(params.returnTo, "/");
  let googleAvailable = false;
  try {
    googleAvailable = (await getPublicConfig()).googleSignInAvailable;
  } catch {
    googleAvailable = false;
  }
  return (
    <AuthFrame
      title="Sign in"
      intro="Resume your airline from its authoritative server state."
      footer={
        <p>
          New player? <Link href="/register">Create an account</Link>
        </p>
      }
    >
      <SignInForm returnTo={returnTo} googleAvailable={googleAvailable} />
    </AuthFrame>
  );
}
