import Link from "next/link";
import { AuthFrame } from "../components/auth-frame";
import { ForgotPasswordForm } from "../components/auth-forms";
export default function ForgotPasswordPage() {
  return (
    <AuthFrame
      title="Recover your account"
      intro="We will send a time-limited reset link if the address is registered."
      footer={
        <p>
          <Link href="/sign-in">Return to sign in</Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
