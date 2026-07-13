"use client";

import type {
  FoundingSelectionRequest,
  ListFounderPackageResponse,
  PreviewAirlineFoundingResponse,
  GetAirlineCareerSummaryResponse,
} from "@airline-manager/contracts";
import {
  AirplaneTilt,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  CurrencyCircleDollar,
  Gauge,
  Ruler,
  UsersThree,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { careerApi, createStableIdempotencyKey, WebApiError } from "../lib/client-api";
import { AirportSelector, type SelectableAirport } from "./airport-selector";
import { Button, Field, OperationalTable, Panel, ProvenanceLabel, StateMessage } from "./ui";

type FounderPackage = ListFounderPackageResponse;
type CareerSummary = GetAirlineCareerSummaryResponse;
type Step = "identity" | "base" | "currency" | "finance" | "review";
const STEPS: readonly Step[] = ["identity", "base", "currency", "finance", "review"];
const LABELS: Record<Step, string> = {
  identity: "Airline identity",
  base: "Home and base",
  currency: "Reporting currency",
  finance: "Founder financing",
  review: "Runway review",
};

const DEFAULT_SELECTION: FoundingSelectionRequest = {
  airlineName: "",
  fictionalIdentityConfirmed: false,
  homeJurisdiction: "",
  principalBaseIataCode: "",
  reportingCurrency: "USD",
  brand: { primaryColor: "#32A7C7", secondaryColor: "#162E3A", logoMark: "" },
  acceptFoundingLoan: false,
  worldRulesetVersion: "",
};

function money(minor: string, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(minor) / 100);
}
function duration(minutes: number) {
  if (minutes === 0) return "At acceptance";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} hr`;
}
export function founderGuidance(category: string) {
  if (category === "turboprop") {
    return {
      staffing: "Small regional operating footprint and specialist turboprop crews.",
      recommendedUse: "Thin regional links and shorter runways",
    };
  }
  if (category === "regional_jet") {
    return {
      staffing: "Moderate crew and airport-service demand for regional jet operations.",
      recommendedUse: "Regional business markets with lower capacity risk",
    };
  }
  return {
    staffing: "Higher crew, fuel, handling, and recurring cash commitments.",
    recommendedUse: "High-demand short and medium-haul routes",
  };
}

export function OnboardingWizard({
  userKey,
  airports,
  worldRulesetVersion,
  initialCareer,
  initialPackage,
}: {
  userKey: string;
  airports: readonly SelectableAirport[];
  worldRulesetVersion: string;
  initialCareer: CareerSummary | null;
  initialPackage: FounderPackage | null;
}) {
  const router = useRouter();
  const draftKey = `airline-manager:founding:v1:${userKey}`;
  const [step, setStep] = useState<Step>(initialCareer ? "review" : "identity");
  const [selection, setSelection] = useState<FoundingSelectionRequest>(() => ({
    ...DEFAULT_SELECTION,
    worldRulesetVersion,
  }));
  const [preview, setPreview] = useState<PreviewAirlineFoundingResponse | null>(null);
  const [career, setCareer] = useState<CareerSummary | null>(initialCareer);
  const [founderPackage, setFounderPackage] = useState<FounderPackage | null>(initialPackage);
  const [selectedOption, setSelectedOption] = useState<string>(
    initialPackage?.options[0]?.code ?? "",
  );
  const [leasePreview, setLeasePreview] = useState<Awaited<
    ReturnType<typeof careerApi.previewLease>
  > | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WebApiError["actionable"] | null>(null);

  useEffect(() => {
    if (initialCareer) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const restored = { ...DEFAULT_SELECTION, ...JSON.parse(raw), worldRulesetVersion };
        queueMicrotask(() => setSelection(restored));
      }
    } catch {
      localStorage.removeItem(draftKey);
    }
  }, [draftKey, initialCareer, worldRulesetVersion]);
  useEffect(() => {
    if (!career) localStorage.setItem(draftKey, JSON.stringify(selection));
  }, [career, draftKey, selection]);
  const selectedAirport = airports.find(
    (airport) => airport.iataCode === selection.principalBaseIataCode,
  );
  const jurisdictionAirports = useMemo(
    () =>
      selection.homeJurisdiction
        ? airports.filter((airport) => airport.countryCode === selection.homeJurisdiction)
        : airports,
    [airports, selection.homeJurisdiction],
  );
  const jurisdictions = useMemo(
    () => [...new Set(airports.map((airport) => airport.countryCode))].sort(),
    [airports],
  );
  const displayNames = useMemo(
    () =>
      typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["en"], { type: "region" })
        : null,
    [],
  );

  function update<K extends keyof FoundingSelectionRequest>(
    key: K,
    value: FoundingSelectionRequest[K],
  ) {
    setSelection((current) => ({ ...current, [key]: value }));
    setError(null);
    setPreview(null);
  }
  function next(event: FormEvent) {
    event.preventDefault();
    const index = STEPS.indexOf(step);
    if (step === "base" && (!selection.homeJurisdiction || !selection.principalBaseIataCode)) {
      setError({
        code: "base_required",
        message: "Select a jurisdiction and principal base.",
        fields: {},
        recoverable: false,
      });
      return;
    }
    if (index < STEPS.length - 1) setStep(STEPS[index + 1]!);
  }
  function back() {
    const index = STEPS.indexOf(step);
    if (index > 0) setStep(STEPS[index - 1]!);
  }
  async function previewFounding() {
    setPending(true);
    setError(null);
    try {
      const result = await careerApi.previewFounding(selection);
      setPreview(result);
      setStep("review");
    } catch (caught) {
      setError(caught instanceof WebApiError ? caught.actionable : null);
    } finally {
      setPending(false);
    }
  }
  async function confirmFounding() {
    setPending(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify(selection);
      const result = await careerApi.confirmFounding(
        selection,
        createStableIdempotencyKey("airline-manager:founding:idempotency", fingerprint),
      );
      localStorage.removeItem(draftKey);
      const [summary, comparison] = await Promise.all([
        careerApi.summary(result.airlineId),
        careerApi.founderPackage(result.airlineId),
      ]);
      setCareer(summary);
      setFounderPackage(comparison);
      setSelectedOption(comparison.options[0]?.code ?? "");
    } catch (caught) {
      setError(caught instanceof WebApiError ? caught.actionable : null);
    } finally {
      setPending(false);
    }
  }
  async function chooseOption(code: string) {
    if (!career) return;
    setSelectedOption(code);
    setPending(true);
    setError(null);
    try {
      setLeasePreview(await careerApi.previewLease(career.airlineId, code));
    } catch (caught) {
      setError(caught instanceof WebApiError ? caught.actionable : null);
    } finally {
      setPending(false);
    }
  }
  async function acceptLease() {
    if (!career || !selectedOption) return;
    setPending(true);
    setError(null);
    try {
      await careerApi.acceptLease(
        career.airlineId,
        selectedOption,
        createStableIdempotencyKey(
          "airline-manager:founder-lease:idempotency",
          `${career.airlineId}:${selectedOption}`,
        ),
      );
      router.push("/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof WebApiError ? caught.actionable : null);
    } finally {
      setPending(false);
    }
  }

  if (career && founderPackage)
    return (
      <FounderSelection
        career={career}
        comparison={founderPackage}
        selectedOption={selectedOption}
        preview={leasePreview}
        pending={pending}
        error={error}
        onSelect={chooseOption}
        onAccept={acceptLease}
      />
    );
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <Link className="wordmark" href="/">
          Airline Manager
        </Link>
        <span>Founding desk</span>
      </header>
      <div className="onboarding-grid">
        <aside className="onboarding-progress">
          <p>Establish your airline</p>
          <ol>
            {STEPS.map((item, index) => (
              <li
                key={item}
                data-active={item === step}
                data-complete={index < STEPS.indexOf(step)}
              >
                <span>{index < STEPS.indexOf(step) ? <Check aria-hidden /> : index + 1}</span>
                {LABELS[item]}
              </li>
            ))}
          </ol>
          <small>Your draft stays on this device until the airline is confirmed.</small>
        </aside>
        <section className="onboarding-main" aria-labelledby="step-title">
          <form onSubmit={next} className="onboarding-form">
            {error ? (
              <StateMessage tone="critical" title="Review this step">
                {error.message}
              </StateMessage>
            ) : null}
            {step === "identity" ? (
              <>
                <header>
                  <p className="context-label">Airline identity</p>
                  <h1 id="step-title">Name the operator</h1>
                  <p>
                    Create a fictional identity. It can evolve, but it must begin distinct from real
                    airlines.
                  </p>
                </header>
                <Field htmlFor="airlineName" label="Airline name" error={error?.fields.airlineName}>
                  <input
                    id="airlineName"
                    value={selection.airlineName}
                    onChange={(event) => update("airlineName", event.target.value)}
                    minLength={3}
                    maxLength={80}
                    required
                  />
                </Field>
                <div className="brand-fields">
                  <Field
                    htmlFor="logoMark"
                    label="Tail mark"
                    hint="One to three letters or numbers."
                  >
                    <input
                      id="logoMark"
                      value={selection.brand.logoMark}
                      onChange={(event) =>
                        update("brand", {
                          ...selection.brand,
                          logoMark: event.target.value.toUpperCase().slice(0, 3),
                        })
                      }
                      pattern="[A-Z0-9]{1,3}"
                      required
                    />
                  </Field>
                  <Field htmlFor="primaryColor" label="Primary color">
                    <input
                      id="primaryColor"
                      type="color"
                      value={selection.brand.primaryColor}
                      onChange={(event) =>
                        update("brand", {
                          ...selection.brand,
                          primaryColor: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <Field htmlFor="secondaryColor" label="Secondary color">
                    <input
                      id="secondaryColor"
                      type="color"
                      value={selection.brand.secondaryColor}
                      onChange={(event) =>
                        update("brand", {
                          ...selection.brand,
                          secondaryColor: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <div
                    className="tail-preview"
                    style={{
                      background: selection.brand.primaryColor,
                      color: selection.brand.secondaryColor,
                    }}
                    aria-label={`Tail mark preview ${selection.brand.logoMark || "empty"}`}
                  >
                    {selection.brand.logoMark || "AM"}
                  </div>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selection.fictionalIdentityConfirmed}
                    onChange={(event) => update("fictionalIdentityConfirmed", event.target.checked)}
                    required
                  />
                  <span>
                    <strong>This is a fictional airline</strong>
                    <small>I am not representing an existing operator.</small>
                  </span>
                </label>
              </>
            ) : null}
            {step === "base" ? (
              <>
                <header>
                  <p className="context-label">Home and base</p>
                  <h1 id="step-title">Choose where operations begin</h1>
                  <p>Your principal base must be in the airline&apos;s home jurisdiction.</p>
                </header>
                <Field htmlFor="jurisdiction" label="Home jurisdiction">
                  <select
                    id="jurisdiction"
                    value={selection.homeJurisdiction}
                    onChange={(event) => {
                      update("homeJurisdiction", event.target.value);
                      update("principalBaseIataCode", "");
                    }}
                    required
                  >
                    <option value="">Select jurisdiction</option>
                    {jurisdictions.map((code) => (
                      <option key={code} value={code}>
                        {displayNames?.of(code) ?? code} ({code})
                      </option>
                    ))}
                  </select>
                </Field>
                <AirportSelector
                  airports={jurisdictionAirports}
                  selectedId={selectedAirport?.id}
                  onSelect={(airport) => update("principalBaseIataCode", airport.iataCode)}
                />
              </>
            ) : null}
            {step === "currency" ? (
              <>
                <header>
                  <p className="context-label">Reporting currency</p>
                  <h1 id="step-title">Set the accounting view</h1>
                  <p>Transactions retain their original currency. Reports use this selection.</p>
                </header>
                <div className="choice-list">
                  {(["USD", "EUR", "GBP", "CHF", "JPY", "KWD"] as const).map((currency) => (
                    <label key={currency} data-selected={selection.reportingCurrency === currency}>
                      <input
                        type="radio"
                        name="currency"
                        value={currency}
                        checked={selection.reportingCurrency === currency}
                        onChange={() => update("reportingCurrency", currency)}
                      />
                      <strong>{currency}</strong>
                      <span>
                        {new Intl.DisplayNames(["en"], { type: "currency" }).of(currency)}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
            {step === "finance" ? (
              <>
                <header>
                  <p className="context-label">Founder financing</p>
                  <h1 id="step-title">Choose the opening liability</h1>
                  <p>
                    Every career receives founder equity. The optional loan adds cash and scheduled
                    repayments.
                  </p>
                </header>
                <div className="finance-choice">
                  <label data-selected={!selection.acceptFoundingLoan}>
                    <input
                      type="radio"
                      name="loan"
                      checked={!selection.acceptFoundingLoan}
                      onChange={() => update("acceptFoundingLoan", false)}
                    />
                    <span>
                      <strong>Equity only</strong>
                      <small>Lower opening cash, no founding-loan repayment schedule.</small>
                    </span>
                  </label>
                  <label data-selected={selection.acceptFoundingLoan}>
                    <input
                      type="radio"
                      name="loan"
                      checked={selection.acceptFoundingLoan}
                      onChange={() => update("acceptFoundingLoan", true)}
                    />
                    <span>
                      <strong>Equity plus loan</strong>
                      <small>More runway now, with exact scheduled repayments.</small>
                    </span>
                  </label>
                </div>
              </>
            ) : null}
            {step === "review" ? (
              <>
                <header>
                  <p className="context-label">Runway review</p>
                  <h1 id="step-title">Review before creating the airline</h1>
                  <p>The backend calculates this forecast from the published founding rules.</p>
                </header>
                {!preview ? (
                  <StateMessage title="Preview required">
                    Run the authoritative preview to see exact equity, loan terms, and runway
                    assumptions.
                  </StateMessage>
                ) : (
                  <RunwayReview preview={preview} />
                )}
              </>
            ) : null}
            <div className="form-actions">
              {step !== "identity" ? (
                <Button type="button" className="button-secondary" onClick={back}>
                  <ArrowLeft aria-hidden />
                  Back
                </Button>
              ) : (
                <span />
              )}
              {step === "review" ? (
                <div>
                  {!preview ? (
                    <Button
                      type="button"
                      className="button-primary"
                      disabled={pending}
                      onClick={previewFounding}
                    >
                      Preview runway
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="button-primary"
                      disabled={pending}
                      onClick={confirmFounding}
                    >
                      Confirm airline
                    </Button>
                  )}
                </div>
              ) : (
                <Button className="button-primary">
                  Continue
                  <ArrowRight aria-hidden />
                </Button>
              )}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function RunwayReview({ preview }: { preview: PreviewAirlineFoundingResponse }) {
  return (
    <div className="runway-review">
      <div className="runway-metric">
        <ProvenanceLabel classification="derived" />
        <span>Pre-aircraft runway</span>
        <strong>
          {preview.runway.runwayDays === null
            ? `${preview.runway.forecastHorizonDays}+ days`
            : `${preview.runway.runwayDays} days`}
        </strong>
      </div>
      <dl>
        <div>
          <dt>Opening cash</dt>
          <dd>{money(preview.runway.openingCashMinor, preview.runway.currency)}</dd>
        </div>
        <div>
          <dt>Founder equity</dt>
          <dd>{money(preview.runway.founderEquityMinor, preview.runway.currency)}</dd>
        </div>
        <div>
          <dt>Loan proceeds</dt>
          <dd>{money(preview.runway.foundingLoanProceedsMinor, preview.runway.currency)}</dd>
        </div>
        <div>
          <dt>Daily baseline</dt>
          <dd>{money(preview.runway.baselineDailyObligationMinor, preview.runway.currency)}</dd>
        </div>
      </dl>
      <div className="assumptions">
        <h2>What this includes</h2>
        <ul>
          {preview.runway.assumptions.included.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2>Not included yet</h2>
        <ul>
          {preview.runway.assumptions.excludedUntilTicket09.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{preview.runway.explanation}</p>
      </div>
    </div>
  );
}

function FounderSelection({
  career,
  comparison,
  selectedOption,
  preview,
  pending,
  error,
  onSelect,
  onAccept,
}: {
  career: CareerSummary;
  comparison: FounderPackage;
  selectedOption: string;
  preview: Awaited<ReturnType<typeof careerApi.previewLease>> | null;
  pending: boolean;
  error: WebApiError["actionable"] | null;
  onSelect: (code: string) => void;
  onAccept: () => void;
}) {
  const option =
    comparison.options.find((item) => item.code === selectedOption) ?? comparison.options[0]!;
  const guidance = founderGuidance(option.variant.category);
  return (
    <main className="founder-shell">
      <header className="founder-header">
        <div>
          <Link className="wordmark" href="/">
            Airline Manager
          </Link>
          <span>{career.name}</span>
        </div>
        <div>
          <p>Principal base</p>
          <strong>{career.principalBase.iataCode}</strong>
        </div>
      </header>
      <section className="founder-intro">
        <p className="context-label">Founder package</p>
        <h1>Select the first aircraft</h1>
        <p>
          All four choices are economically viable. Compare capacity, operating reach, runway
          access, delivery, and recurring commitment.
        </p>
      </section>
      {error ? (
        <StateMessage tone="critical" title="Selection not completed">
          {error.message}
        </StateMessage>
      ) : null}
      <section className="aircraft-comparison" aria-label="Founder aircraft comparison">
        <div className="aircraft-tabs" role="tablist" aria-label="Aircraft variants">
          {comparison.options.map((item) => (
            <button
              key={item.code}
              role="tab"
              aria-selected={item.code === option.code}
              onClick={() => onSelect(item.code)}
            >
              <span>{item.variant.manufacturer}</span>
              <strong>{item.variant.model}</strong>
              <small>{item.cabin.economySeats} seats</small>
            </button>
          ))}
        </div>
        <Panel className="aircraft-detail">
          <div className="aircraft-title">
            <div>
              <ProvenanceLabel classification="sourced" />
              <h2>
                {option.variant.manufacturer} {option.variant.model}
              </h2>
              <p>{guidance.recommendedUse}</p>
            </div>
            <div className="aircraft-silhouette">
              <AirplaneTilt aria-hidden weight="thin" />
            </div>
          </div>
          <div className="aircraft-metrics">
            <div>
              <UsersThree aria-hidden />
              <span>Economy capacity</span>
              <strong>{option.cabin.economySeats} seats</strong>
            </div>
            <div>
              <Gauge aria-hidden />
              <span>Published range</span>
              <strong>{option.variant.rangeNm.toLocaleString()} nm</strong>
            </div>
            <div>
              <Ruler aria-hidden />
              <span>Runway envelope</span>
              <strong>{option.variant.minimumRunwayFt.toLocaleString()} ft</strong>
            </div>
            <div>
              <Clock aria-hidden />
              <span>Estimated delivery</span>
              <strong>{duration(option.delivery.delayMinutes)}</strong>
            </div>
            <div>
              <CurrencyCircleDollar aria-hidden />
              <span>Recurring lease</span>
              <strong>
                {money(option.lease.recurringPaymentMinor, option.lease.currency)} /{" "}
                {option.lease.paymentIntervalDays} days
              </strong>
            </div>
          </div>
          <div className="tradeoff-grid">
            <div>
              <h3>Network fit</h3>
              <p>{option.tradeoffs.network}</p>
            </div>
            <div>
              <h3>Runway access</h3>
              <p>{option.tradeoffs.runway}</p>
            </div>
            <div>
              <h3>Operating implication</h3>
              <p>{guidance.staffing}</p>
            </div>
            <div>
              <h3>Commitment</h3>
              <p>{option.tradeoffs.cost}</p>
            </div>
          </div>
          <p className="provenance-notice">
            <ProvenanceLabel classification="balance" /> {option.provenanceNotice}
          </p>
          {preview ? (
            <div className="lease-preview">
              <h3>Acceptance schedule</h3>
              <OperationalTable label="Founder lease payment schedule">
                <thead>
                  <tr>
                    <th>Payment</th>
                    <th>Due</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.paymentSchedule.map((payment) => (
                    <tr key={payment.paymentNumber}>
                      <td>{payment.paymentNumber}</td>
                      <td>{new Date(payment.dueAt).toLocaleDateString()}</td>
                      <td>{money(payment.amountMinor, option.lease.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </OperationalTable>
              <p>{preview.nextStepGuidance}</p>
            </div>
          ) : (
            <StateMessage title="Review the exact schedule">
              Select this aircraft to load its backend-calculated delivery target and lease
              schedule.
            </StateMessage>
          )}
          <div className="form-actions">
            <Button
              className="button-secondary"
              disabled={pending}
              onClick={() => onSelect(option.code)}
            >
              Preview schedule
            </Button>
            <Button
              className="button-primary"
              disabled={pending || !preview || preview.option.code !== option.code}
              onClick={onAccept}
            >
              Accept founder lease
            </Button>
          </div>
        </Panel>
      </section>
    </main>
  );
}
