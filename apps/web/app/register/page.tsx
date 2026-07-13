import Link from "next/link";
import { AuthFrame } from "../components/auth-frame";
import { RegistrationForm } from "../components/auth-forms";

export default function RegisterPage() {
  return (
    <AuthFrame
      title="Create your player account"
      intro="Verify your email before founding a persistent airline."
      footer={
        <p>
          Already registered? <Link href="/sign-in">Sign in</Link>
        </p>
      }
    >
      <RegistrationForm />
    </AuthFrame>
  );
}
