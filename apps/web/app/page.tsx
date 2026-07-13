import { redirect } from "next/navigation";
import { getCurrentCareer, getSession } from "./lib/api";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.user.emailVerified)
    redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`);
  try {
    const current = await getCurrentCareer();
    redirect(current.career ? "/app" : "/onboarding");
  } catch {
    redirect("/onboarding");
  }
}
