"use client";

import type { FinanceStatements, JournalPage } from "@airline-manager/domain";
import { formatDateTime, formatMoney } from "../lib/planning-format";

function StatementTable({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: readonly {
    accountCode?: string;
    accountName?: string;
    group: string;
    amountMinor: string;
  }[];
  currency: string;
}) {
  return (
    <section className="statement-section">
      <h3>{title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Group</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.accountCode ?? row.group}-${row.accountName ?? "total"}`}>
                <th scope="row">
                  {row.accountCode ? `${row.accountCode} ` : ""}
                  {row.accountName ?? row.group}
                </th>
                <td>{row.group.replaceAll("_", " ")}</td>
                <td>{formatMoney(row.amountMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdvancedFinance({
  statements,
  journals,
}: {
  statements: FinanceStatements;
  journals: JournalPage;
}) {
  const reconciled =
    statements.reconciliation.journalsBalanced &&
    statements.reconciliation.trialBalanceDifferenceMinor === "0" &&
    statements.reconciliation.balanceSheetDifferenceMinor === "0";
  return (
    <div className="advanced-finance">
      <header className="advanced-heading">
        <div>
          <p className="eyebrow">Posted double-entry ledger</p>
          <h2>Financial statements</h2>
          <small>
            {formatDateTime(statements.period.from)} to {formatDateTime(statements.period.to)} ·{" "}
            {statements.reportingCurrency}
          </small>
        </div>
        <p className="reconciliation-status" data-balanced={reconciled} role="status">
          <span aria-hidden />
          {reconciled ? "Ledger and statements reconcile" : "Reconciliation requires review"}
        </p>
      </header>
      <section className="statement-summary" aria-label="Statement reconciliation totals">
        <div>
          <span>Net income</span>
          <strong>
            {formatMoney(statements.profitAndLoss.netIncomeMinor, statements.reportingCurrency)}
          </strong>
        </div>
        <div>
          <span>Assets</span>
          <strong>
            {formatMoney(statements.balanceSheet.assetsMinor, statements.reportingCurrency)}
          </strong>
        </div>
        <div>
          <span>Liabilities and equity</span>
          <strong>
            {formatMoney(
              statements.balanceSheet.liabilitiesAndEquityMinor,
              statements.reportingCurrency,
            )}
          </strong>
        </div>
        <div>
          <span>Current earnings</span>
          <strong>
            {formatMoney(
              statements.balanceSheet.currentEarningsMinor,
              statements.reportingCurrency,
            )}
          </strong>
        </div>
        <div>
          <span>Net cash change</span>
          <strong>
            {formatMoney(statements.cashFlow.netCashChangeMinor, statements.reportingCurrency)}
          </strong>
        </div>
      </section>
      <StatementTable
        title="Profit and loss"
        rows={statements.profitAndLoss.rows}
        currency={statements.reportingCurrency}
      />
      <StatementTable
        title="Balance sheet"
        rows={statements.balanceSheet.rows}
        currency={statements.reportingCurrency}
      />
      <StatementTable
        title="Cash flow"
        rows={statements.cashFlow.rows}
        currency={statements.reportingCurrency}
      />
      <section className="journal-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Read-only posted history</p>
            <h3>Journal entries</h3>
          </div>
          <small>As of {formatDateTime(journals.asOf)}</small>
        </div>
        <div className="journal-list">
          {journals.items.map((journal) => (
            <details key={journal.id}>
              <summary>
                <span>
                  <strong>{journal.description}</strong>
                  <small>
                    {formatDateTime(journal.occurredAt)} · {journal.transactionCurrency} ·{" "}
                    {journal.commandType}
                  </small>
                </span>
                <code>#{journal.sequence}</code>
              </summary>
              {journal.source ? (
                <p>
                  Source {journal.source.entityType}: <code>{journal.source.entityId}</code>
                </p>
              ) : null}
              <table>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Side</th>
                    <th scope="col">Transaction</th>
                    <th scope="col">Reporting</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.lines.map((line) => (
                    <tr key={`${journal.id}-${line.accountCode}-${line.side}`}>
                      <th scope="row">
                        {line.accountCode} {line.accountName}
                      </th>
                      <td>{line.side}</td>
                      <td>
                        {formatMoney(line.transactionAmountMinor, journal.transactionCurrency)}
                      </td>
                      <td>{formatMoney(line.reportingAmountMinor, journals.reportingCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
        {journals.nextCursor ? (
          <p className="bounded-note">
            More posted entries are available through bounded pagination.
          </p>
        ) : null}
      </section>
    </div>
  );
}
