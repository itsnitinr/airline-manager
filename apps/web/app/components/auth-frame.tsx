import Link from "next/link";
import type { ReactNode } from "react";

export function AuthFrame({
  title,
  intro,
  children,
  footer,
}: Readonly<{ title: string; intro: string; children: ReactNode; footer?: ReactNode }>) {
  return (
    <main className="auth-layout">
      <section className="auth-context" aria-labelledby="product-name">
        <Link className="wordmark" href="/" id="product-name">
          Airline Manager
        </Link>
        <div className="auth-context-copy">
          <p className="context-label">Career operations</p>
          <h2>Build the network before you fly it.</h2>
          <p>Choose a real base, understand the runway, then commit to one starter aircraft.</p>
        </div>
        <p className="auth-footnote">Persistent careers require a verified account.</p>
      </section>
      <section className="auth-form-region">
        <div className="auth-form-wrap">
          <header>
            <h1>{title}</h1>
            <p>{intro}</p>
          </header>
          {children}
          {footer ? <footer>{footer}</footer> : null}
        </div>
      </section>
    </main>
  );
}
