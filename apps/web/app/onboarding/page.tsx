import type {
  GetAirlineCareerSummaryResponse,
  ListFleetResponse,
  ListFounderPackageResponse,
} from "@airline-manager/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "../components/onboarding-wizard";
import { StateMessage } from "../components/ui";
import { getCurrentCareer, getPublishedCatalog, getSession, serverApiFetch } from "../lib/api";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?returnTo=/onboarding");
  if (!session.user.emailVerified) {
    redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`);
  }

  let data:
    | Readonly<{
        career: GetAirlineCareerSummaryResponse | null;
        comparison: ListFounderPackageResponse | null;
        fleet: ListFleetResponse;
        catalog: Awaited<ReturnType<typeof getPublishedCatalog>>;
      }>
    | undefined;

  try {
    const [current, catalog] = await Promise.all([getCurrentCareer(), getPublishedCatalog()]);
    const career = current.career as GetAirlineCareerSummaryResponse | null;
    const [fleet, comparison] = career
      ? await Promise.all([
          serverApiFetch<ListFleetResponse>(`/v1/airlines/${career.airlineId}/fleet`),
          serverApiFetch<ListFounderPackageResponse>(
            `/v1/airlines/${career.airlineId}/founder-package`,
          ),
        ])
      : [[], null];
    data = { career, comparison, fleet, catalog };
  } catch {
    return (
      <main className="centered-state">
        <StateMessage tone="critical" title="Onboarding data unavailable">
          The published catalog or career state could not be loaded. Check the API and try again.
        </StateMessage>
        <Link className="button button-primary" href="/onboarding">
          Retry
        </Link>
      </main>
    );
  }

  if (data.fleet.length > 0) redirect("/app");
  const airports = data.catalog.airports.map(
    ({
      id,
      iataCode,
      name,
      municipality,
      countryCode,
      latitudeDeg,
      longitudeDeg,
      longestRunwayFt,
    }) => ({
      id,
      iataCode,
      name,
      municipality,
      countryCode,
      latitudeDeg,
      longitudeDeg,
      longestRunwayFt,
    }),
  );

  return (
    <OnboardingWizard
      userKey={session.user.id}
      airports={airports}
      worldRulesetVersion={data.catalog.worldRulesetVersion}
      initialCareer={data.career}
      initialPackage={data.comparison}
    />
  );
}
