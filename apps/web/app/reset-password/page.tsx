import { AuthFrame } from "../components/auth-frame";
import { ResetPasswordForm } from "../components/auth-forms";
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return (
    <AuthFrame
      title="Set a new password"
      intro="All existing sessions will be revoked after this change."
    >
      <ResetPasswordForm token={token} />
    </AuthFrame>
  );
}
