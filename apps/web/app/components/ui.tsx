import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`.trim()} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: Readonly<{
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  htmlFor: string;
  children: ReactNode;
}>) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const control = isValidElement<{
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false";
  }>(children)
    ? cloneElement(children, {
        ...(hintId || errorId
          ? {
              "aria-describedby": [
                ...new Set(
                  [children.props["aria-describedby"], hintId, errorId]
                    .filter(Boolean)
                    .flatMap((value) => value!.split(" ")),
                ),
              ].join(" "),
            }
          : {}),
        ...(error ? { "aria-invalid": true } : {}),
      })
    : children;
  return (
    <div className="field" data-invalid={Boolean(error)}>
      <label htmlFor={htmlFor}>{label}</label>
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
      {control}
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`panel ${className}`.trim()} {...props} />;
}

export function StateMessage({
  tone = "neutral",
  title,
  children,
  action,
}: Readonly<{
  tone?: "neutral" | "warning" | "critical" | "nominal";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}>) {
  return (
    <div className="state-message" data-tone={tone} role={tone === "critical" ? "alert" : "status"}>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton" aria-label={label} role="status">
      <span />
    </div>
  );
}

export function ProvenanceLabel({
  classification,
}: {
  classification: "sourced" | "derived" | "balance";
}) {
  const labels = {
    sourced: "Published fact",
    derived: "Derived forecast",
    balance: "Game balance",
  };
  return (
    <span className="provenance" data-classification={classification}>
      {labels[classification]}
    </span>
  );
}

export function OperationalTable({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="table-scroll" role="region" aria-label={`${label} scroll area`} tabIndex={0}>
      <table aria-label={label}>{children}</table>
    </div>
  );
}
