import type {
  GetAirlineCareerSummaryResponse,
  ListFleetResponse,
} from "@airline-manager/contracts";
import { redirect } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { getCurrentCareer, getPublishedCatalog, getSession, serverApiFetch } from "../lib/api";

export default async function ApplicationPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?returnTo=/app");
  if (!session.user.emailVerified)
    redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`);
  const [current, catalog] = await Promise.all([getCurrentCareer(), getPublishedCatalog()]);
  const career = current.career as GetAirlineCareerSummaryResponse | null;
  if (!career) redirect("/onboarding");
  const fleet = await serverApiFetch<ListFleetResponse>(`/v1/airlines/${career.airlineId}/fleet`);
  if (fleet.length === 0) redirect("/onboarding");
  const airports = catalog.airports.map(({ id, iataCode, name, latitudeDeg, longitudeDeg }) => ({
    id,
    iataCode,
    name,
    latitudeDeg,
    longitudeDeg,
  }));
  return (
    <AppShell career={career} fleet={fleet} airports={airports} userEmail={session.user.email} />
  );
}
