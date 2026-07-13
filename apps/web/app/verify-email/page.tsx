import Link from "next/link";
import { AuthFrame } from "../components/auth-frame";
import { VerificationForm } from "../components/auth-forms";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : "";
  const verified = params.verified === "1";
  return (
    <AuthFrame
      title={verified ? "Verification complete" : "Verify your email"}
      intro="Verification links expire after one hour."
      footer={
        <p>
          <Link href="/sign-in">Return to sign in</Link>
        </p>
      }
    >
      <VerificationForm email={email} verified={verified} />
    </AuthFrame>
  );
}
