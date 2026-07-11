CREATE TABLE currencies (
  code char(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4),
  name text NOT NULL CHECK (name <> ''),
  rounding_mode text NOT NULL DEFAULT 'half_even' CHECK (rounding_mode = 'half_even')
);

INSERT INTO currencies (code, minor_units, name) VALUES
  ('CHF', 2, 'Swiss franc'), ('EUR', 2, 'Euro'), ('GBP', 2, 'Pound sterling'),
  ('JPY', 0, 'Japanese yen'), ('KWD', 3, 'Kuwaiti dinar'), ('USD', 2, 'United States dollar');

CREATE TABLE chart_of_accounts_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_-]+$'),
  name text NOT NULL CHECK (name <> '')
);

CREATE TABLE chart_of_accounts_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES chart_of_accounts_templates (id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  description text NOT NULL CHECK (description <> ''),
  published_at timestamptz,
  UNIQUE (template_id, version),
  CONSTRAINT chart_template_version_publication CHECK (
    (status = 'draft' AND published_at IS NULL) OR
    (status IN ('published', 'retired') AND published_at IS NOT NULL)
  )
);

CREATE TABLE chart_of_accounts_template_accounts (
  template_version_id uuid NOT NULL REFERENCES chart_of_accounts_template_versions (id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  name text NOT NULL CHECK (name <> ''),
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  cash_flow_activity text CHECK (cash_flow_activity IN ('operating', 'investing', 'financing')),
  is_cash boolean NOT NULL DEFAULT false,
  is_fx_clearing boolean NOT NULL DEFAULT false,
  PRIMARY KEY (template_version_id, code)
);

WITH template AS (
  INSERT INTO chart_of_accounts_templates (code, name)
  VALUES ('airline-career', 'Airline career chart of accounts') RETURNING id
), version AS (
  INSERT INTO chart_of_accounts_template_versions
    (template_id, version, status, description, published_at)
  SELECT id, 1, 'draft',
    'Structural airline accounting accounts only; contains no founding or economy balance values.',
    NULL FROM template RETURNING id
)
INSERT INTO chart_of_accounts_template_accounts
  (template_version_id, code, name, account_type, normal_balance, cash_flow_activity, is_cash, is_fx_clearing)
SELECT version.id, account.code, account.name, account.account_type, account.normal_balance,
  account.cash_flow_activity, account.is_cash, account.is_fx_clearing
FROM version CROSS JOIN (VALUES
  ('1000', 'Cash', 'asset', 'debit', 'operating', true, false),
  ('1100', 'Accounts receivable', 'asset', 'debit', 'operating', false, false),
  ('1200', 'Fuel inventory', 'asset', 'debit', 'operating', false, false),
  ('1500', 'Aircraft and equipment', 'asset', 'debit', 'investing', false, false),
  ('1600', 'Right-of-use lease assets', 'asset', 'debit', 'financing', false, false),
  ('1900', 'FX clearing and rounding', 'asset', 'debit', 'operating', false, true),
  ('2000', 'Accounts payable', 'liability', 'credit', 'operating', false, false),
  ('2100', 'Refund liabilities', 'liability', 'credit', 'operating', false, false),
  ('2200', 'Loans payable', 'liability', 'credit', 'financing', false, false),
  ('2300', 'Lease liabilities', 'liability', 'credit', 'financing', false, false),
  ('3000', 'Owner equity', 'equity', 'credit', 'financing', false, false),
  ('3100', 'Retained earnings', 'equity', 'credit', 'operating', false, false),
  ('4000', 'Passenger and cargo revenue', 'revenue', 'credit', 'operating', false, false),
  ('4100', 'Realized foreign exchange gain', 'revenue', 'credit', 'operating', false, false),
  ('4200', 'Unrealized foreign exchange gain', 'revenue', 'credit', 'operating', false, false),
  ('5000', 'Fuel expense', 'expense', 'debit', 'operating', false, false),
  ('5100', 'Wages expense', 'expense', 'debit', 'operating', false, false),
  ('5200', 'Maintenance expense', 'expense', 'debit', 'operating', false, false),
  ('5300', 'Airport and station expense', 'expense', 'debit', 'operating', false, false),
  ('5400', 'Lease expense', 'expense', 'debit', 'operating', false, false),
  ('5500', 'Interest expense', 'expense', 'debit', 'operating', false, false),
  ('5600', 'Refund expense', 'expense', 'debit', 'operating', false, false),
  ('5700', 'Realized foreign exchange loss', 'expense', 'debit', 'operating', false, false),
  ('5800', 'Unrealized foreign exchange loss', 'expense', 'debit', 'operating', false, false),
  ('5900', 'Other adjustments', 'expense', 'debit', 'operating', false, false)
) AS account(code, name, account_type, normal_balance, cash_flow_activity, is_cash, is_fx_clearing);

UPDATE chart_of_accounts_template_versions SET status = 'published', published_at = CURRENT_TIMESTAMP
WHERE template_id = (SELECT id FROM chart_of_accounts_templates WHERE code = 'airline-career')
  AND version = 1;

CREATE TABLE ledger_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type <> ''),
  owner_id uuid NOT NULL,
  reporting_currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES chart_of_accounts_template_versions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_type, owner_id)
);

CREATE TABLE accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_book_id uuid NOT NULL REFERENCES ledger_books (id) ON DELETE RESTRICT,
  period_key text NOT NULL CHECK (period_key <> ''),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  closed_at timestamptz,
  UNIQUE (ledger_book_id, period_key),
  CHECK (ends_on >= starts_on),
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status <> 'open' AND closed_at IS NOT NULL))
);

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_book_id uuid NOT NULL REFERENCES ledger_books (id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES chart_of_accounts_template_versions (id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  name text NOT NULL CHECK (name <> ''),
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  cash_flow_activity text CHECK (cash_flow_activity IN ('operating', 'investing', 'financing')),
  is_cash boolean NOT NULL DEFAULT false,
  is_fx_clearing boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (ledger_book_id, code),
  FOREIGN KEY (template_version_id, code)
    REFERENCES chart_of_accounts_template_accounts (template_version_id, code) ON DELETE RESTRICT
);

CREATE TABLE exchange_rate_sources (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]+$'),
  name text NOT NULL CHECK (name <> ''),
  interface_version integer NOT NULL CHECK (interface_version > 0)
);

CREATE TABLE exchange_rate_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES exchange_rate_sources (id) ON DELETE RESTRICT,
  source_version text NOT NULL CHECK (source_version <> ''),
  effective_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  UNIQUE (source_id, source_version, sha256)
);

CREATE TABLE exchange_rates (
  import_id uuid NOT NULL REFERENCES exchange_rate_imports (id) ON DELETE RESTRICT,
  base_currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  quote_currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  rate_numerator bigint NOT NULL CHECK (rate_numerator > 0),
  rate_denominator bigint NOT NULL CHECK (rate_denominator > 0),
  PRIMARY KEY (import_id, base_currency, quote_currency),
  CHECK (base_currency <> quote_currency)
);

INSERT INTO exchange_rate_sources (id, name, interface_version)
VALUES ('offline-fixture', 'Deterministic offline exchange-rate fixture', 1);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_book_id uuid NOT NULL REFERENCES ledger_books (id) ON DELETE RESTRICT,
  accounting_period_id uuid NOT NULL REFERENCES accounting_periods (id) ON DELETE RESTRICT,
  command_type text NOT NULL CHECK (command_type IN
    ('cash', 'equity', 'loan', 'lease', 'fuel', 'revenue', 'wages', 'maintenance',
     'airport_cost', 'refund', 'adjustment')),
  entry_kind text NOT NULL DEFAULT 'standard' CHECK (entry_kind IN ('standard', 'adjustment', 'reversal')),
  cash_flow_activity text NOT NULL DEFAULT 'operating' CHECK (cash_flow_activity IN ('operating', 'investing', 'financing')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  transaction_currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  reporting_currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  exchange_rate_import_id uuid REFERENCES exchange_rate_imports (id) ON DELETE RESTRICT,
  exchange_rate_numerator bigint,
  exchange_rate_denominator bigint,
  description text NOT NULL CHECK (description <> ''),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at timestamptz,
  reversal_of_journal_entry_id uuid UNIQUE REFERENCES journal_entries (id) ON DELETE RESTRICT,
  CONSTRAINT journal_entry_rate_snapshot CHECK (
    (transaction_currency = reporting_currency AND exchange_rate_import_id IS NULL AND
      exchange_rate_numerator IS NULL AND exchange_rate_denominator IS NULL) OR
    (transaction_currency <> reporting_currency AND exchange_rate_import_id IS NOT NULL AND
      exchange_rate_numerator > 0 AND exchange_rate_denominator > 0)
  ),
  CHECK ((status = 'draft' AND posted_at IS NULL) OR (status = 'posted' AND posted_at IS NOT NULL)),
  CHECK ((entry_kind = 'reversal') = (reversal_of_journal_entry_id IS NOT NULL))
);

CREATE TABLE ledger_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries (id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES ledger_accounts (id) ON DELETE RESTRICT,
  line_number integer NOT NULL CHECK (line_number > 0),
  side text NOT NULL CHECK (side IN ('debit', 'credit')),
  transaction_amount_minor bigint NOT NULL CHECK (transaction_amount_minor >= 0),
  reporting_amount_minor bigint NOT NULL CHECK (reporting_amount_minor >= 0),
  airline_id uuid,
  aircraft_id uuid,
  route_id uuid,
  flight_id uuid,
  station_id uuid,
  contract_id uuid,
  memo text,
  UNIQUE (journal_entry_id, line_number),
  CHECK (transaction_amount_minor > 0 OR reporting_amount_minor > 0)
);

CREATE INDEX journal_entries_book_time_idx ON journal_entries (ledger_book_id, occurred_at, id)
  WHERE status = 'posted';
CREATE INDEX ledger_postings_account_idx ON ledger_postings (account_id, journal_entry_id);
CREATE INDEX ledger_postings_dimensions_idx ON ledger_postings
  (airline_id, aircraft_id, route_id, flight_id, station_id, contract_id);
CREATE INDEX exchange_rate_imports_effective_idx ON exchange_rate_imports
  (source_id, effective_at DESC, id);

CREATE FUNCTION reject_published_chart_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'chart_of_accounts_template_versions' AND NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'chart template versions must be assembled as drafts' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'chart_of_accounts_template_accounts' AND EXISTS (
      SELECT 1 FROM chart_of_accounts_template_versions WHERE id = NEW.template_version_id AND status <> 'draft') THEN
      RAISE EXCEPTION 'published chart template accounts are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'chart_of_accounts_template_versions' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published chart template versions are immutable' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM chart_of_accounts_template_versions
      WHERE id = OLD.template_version_id AND status <> 'draft') THEN
      RAISE EXCEPTION 'published chart template accounts are immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'chart_of_accounts_template_versions'
    AND NEW.status <> 'draft' AND NOT EXISTS (
      SELECT 1 FROM chart_of_accounts_template_accounts WHERE template_version_id = NEW.id) THEN
    RAISE EXCEPTION 'a published chart template version requires accounts' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER chart_template_versions_immutable BEFORE INSERT OR UPDATE OR DELETE
  ON chart_of_accounts_template_versions FOR EACH ROW EXECUTE FUNCTION reject_published_chart_mutation();
CREATE TRIGGER chart_template_accounts_immutable BEFORE INSERT OR UPDATE OR DELETE
  ON chart_of_accounts_template_accounts FOR EACH ROW EXECUTE FUNCTION reject_published_chart_mutation();

CREATE FUNCTION reject_finance_reference_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finance reference and account records are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER currencies_immutable BEFORE UPDATE OR DELETE ON currencies
  FOR EACH ROW EXECUTE FUNCTION reject_finance_reference_mutation();
CREATE TRIGGER chart_templates_immutable BEFORE UPDATE OR DELETE ON chart_of_accounts_templates
  FOR EACH ROW EXECUTE FUNCTION reject_finance_reference_mutation();
CREATE TRIGGER ledger_books_immutable BEFORE UPDATE OR DELETE ON ledger_books
  FOR EACH ROW EXECUTE FUNCTION reject_finance_reference_mutation();
CREATE TRIGGER ledger_accounts_immutable BEFORE UPDATE OR DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION reject_finance_reference_mutation();
CREATE TRIGGER exchange_rate_imports_immutable BEFORE UPDATE OR DELETE ON exchange_rate_imports
  FOR EACH ROW EXECUTE FUNCTION reject_finance_reference_mutation();
CREATE TRIGGER exchange_rates_immutable BEFORE UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION reject_finance_reference_mutation();

CREATE FUNCTION validate_ledger_account_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts_template_accounts t
    WHERE t.template_version_id = NEW.template_version_id AND t.code = NEW.code
      AND t.name = NEW.name AND t.account_type = NEW.account_type
      AND t.normal_balance = NEW.normal_balance
      AND t.cash_flow_activity IS NOT DISTINCT FROM NEW.cash_flow_activity
      AND t.is_cash = NEW.is_cash AND t.is_fx_clearing = NEW.is_fx_clearing) THEN
    RAISE EXCEPTION 'ledger account must exactly match its template version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_accounts_match_template BEFORE INSERT ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION validate_ledger_account_template();

CREATE FUNCTION enforce_period_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_periods p WHERE p.ledger_book_id = NEW.ledger_book_id
    AND p.id <> NEW.id AND daterange(p.starts_on, p.ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')) THEN
    RAISE EXCEPTION 'accounting periods may not overlap' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> NEW.status AND NOT (
    (OLD.status = 'open' AND NEW.status IN ('closed', 'locked')) OR
    (OLD.status = 'closed' AND NEW.status = 'locked')) THEN
    RAISE EXCEPTION 'accounting periods cannot be reopened' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.ledger_book_id, OLD.period_key, OLD.starts_on, OLD.ends_on)
    IS DISTINCT FROM (NEW.ledger_book_id, NEW.period_key, NEW.starts_on, NEW.ends_on)
    AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.accounting_period_id = OLD.id AND j.status = 'posted') THEN
    RAISE EXCEPTION 'accounting periods containing posted journals cannot be redefined' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER accounting_period_rules BEFORE INSERT OR UPDATE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION enforce_period_rules();

CREATE FUNCTION protect_ledger_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM journal_entries WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  IF TG_OP IN ('UPDATE', 'DELETE') AND parent_status = 'posted' THEN
    RAISE EXCEPTION 'posted ledger postings are append-only' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' AND parent_status = 'posted' THEN
    RAISE EXCEPTION 'cannot append to a posted journal' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER ledger_postings_protected BEFORE INSERT OR UPDATE OR DELETE ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION protect_ledger_posting();

CREATE FUNCTION validate_journal_finalization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transaction_delta numeric; reporting_delta numeric; line_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'posted journal entries are append-only' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW.status = 'posted' THEN
    IF NOT EXISTS (SELECT 1 FROM accounting_periods p WHERE p.id = NEW.accounting_period_id
      AND p.ledger_book_id = NEW.ledger_book_id AND p.status = 'open'
      AND NEW.occurred_at::date BETWEEN p.starts_on AND p.ends_on) THEN
      RAISE EXCEPTION 'journal accounting period is not open or does not contain occurrence date' USING ERRCODE = '23514';
    END IF;
    IF NEW.reporting_currency <> (SELECT reporting_currency FROM ledger_books WHERE id = NEW.ledger_book_id) THEN
      RAISE EXCEPTION 'journal reporting currency differs from ledger book' USING ERRCODE = '23514';
    END IF;
    IF NEW.transaction_currency <> NEW.reporting_currency AND NOT EXISTS (
      SELECT 1 FROM exchange_rates r WHERE r.import_id = NEW.exchange_rate_import_id
        AND r.base_currency = NEW.transaction_currency AND r.quote_currency = NEW.reporting_currency
        AND r.rate_numerator = NEW.exchange_rate_numerator
        AND r.rate_denominator = NEW.exchange_rate_denominator) THEN
      RAISE EXCEPTION 'journal exchange-rate snapshot does not match its versioned import' USING ERRCODE = '23514';
    END IF;
    SELECT count(*),
      COALESCE(sum(CASE side WHEN 'debit' THEN transaction_amount_minor ELSE -transaction_amount_minor END), 0),
      COALESCE(sum(CASE side WHEN 'debit' THEN reporting_amount_minor ELSE -reporting_amount_minor END), 0)
    INTO line_count, transaction_delta, reporting_delta FROM ledger_postings WHERE journal_entry_id = NEW.id;
    IF line_count < 2 OR transaction_delta <> 0 OR reporting_delta <> 0 THEN
      RAISE EXCEPTION 'posted journal must have at least two lines and balance in transaction and reporting currency' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id
      WHERE p.journal_entry_id = NEW.id AND a.ledger_book_id <> NEW.ledger_book_id) THEN
      RAISE EXCEPTION 'journal postings must use accounts from the same ledger book' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_entries_finalization BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION validate_journal_finalization();

CREATE FUNCTION protect_posted_journal_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'posted journal entries are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER journal_entries_delete_protected BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_delete();

CREATE FUNCTION finalize_journal(p_journal_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
  SELECT status INTO current_status FROM journal_entries WHERE id = p_journal_id FOR UPDATE;
  IF current_status IS NULL THEN RAISE EXCEPTION 'journal not found' USING ERRCODE = 'P0002'; END IF;
  IF current_status = 'posted' THEN RETURN; END IF;
  PERFORM 1 FROM accounting_periods p JOIN journal_entries j ON j.accounting_period_id = p.id
    WHERE j.id = p_journal_id FOR UPDATE OF p;
  UPDATE journal_entries SET status = 'posted', posted_at = CURRENT_TIMESTAMP WHERE id = p_journal_id;
END;
$$;

CREATE VIEW ledger_account_balances AS
SELECT a.ledger_book_id, a.id AS account_id, a.code, a.name, a.account_type, a.normal_balance,
  j.transaction_currency,
  sum(CASE p.side WHEN 'debit' THEN p.transaction_amount_minor ELSE -p.transaction_amount_minor END)::bigint AS transaction_balance_minor,
  sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END)::bigint AS reporting_balance_minor
FROM ledger_accounts a JOIN ledger_postings p ON p.account_id = a.id
JOIN journal_entries j ON j.id = p.journal_entry_id AND j.status = 'posted'
GROUP BY a.ledger_book_id, a.id, a.code, a.name, a.account_type, a.normal_balance, j.transaction_currency;

CREATE VIEW ledger_cash_report AS
SELECT a.ledger_book_id, j.transaction_currency,
  sum(CASE p.side WHEN 'debit' THEN p.transaction_amount_minor ELSE -p.transaction_amount_minor END)::bigint AS transaction_amount_minor,
  sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END)::bigint AS reporting_amount_minor
FROM ledger_accounts a JOIN ledger_postings p ON p.account_id = a.id
JOIN journal_entries j ON j.id = p.journal_entry_id AND j.status = 'posted'
WHERE a.is_cash GROUP BY a.ledger_book_id, j.transaction_currency;

CREATE VIEW ledger_profit_and_loss_report AS
SELECT a.ledger_book_id, a.account_type, a.code, a.name, j.transaction_currency,
  sum(CASE WHEN a.account_type = 'revenue' THEN
    CASE p.side WHEN 'credit' THEN p.transaction_amount_minor ELSE -p.transaction_amount_minor END ELSE
    CASE p.side WHEN 'debit' THEN p.transaction_amount_minor ELSE -p.transaction_amount_minor END END)::bigint AS transaction_amount_minor,
  sum(CASE WHEN a.account_type = 'revenue' THEN
    CASE p.side WHEN 'credit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END ELSE
    CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END END)::bigint AS reporting_amount_minor
FROM ledger_accounts a JOIN ledger_postings p ON p.account_id = a.id
JOIN journal_entries j ON j.id = p.journal_entry_id AND j.status = 'posted'
WHERE a.account_type IN ('revenue', 'expense')
GROUP BY a.ledger_book_id, a.account_type, a.code, a.name, j.transaction_currency;

CREATE VIEW ledger_balance_sheet_report AS
SELECT a.ledger_book_id, a.account_type, a.code, a.name, j.transaction_currency,
  sum(CASE WHEN a.normal_balance = 'debit' THEN
    CASE p.side WHEN 'debit' THEN p.transaction_amount_minor ELSE -p.transaction_amount_minor END ELSE
    CASE p.side WHEN 'credit' THEN p.transaction_amount_minor ELSE -p.transaction_amount_minor END END)::bigint AS transaction_amount_minor,
  sum(CASE WHEN a.normal_balance = 'debit' THEN
    CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END ELSE
    CASE p.side WHEN 'credit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END END)::bigint AS reporting_amount_minor
FROM ledger_accounts a JOIN ledger_postings p ON p.account_id = a.id
JOIN journal_entries j ON j.id = p.journal_entry_id AND j.status = 'posted'
WHERE a.account_type IN ('asset', 'liability', 'equity')
GROUP BY a.ledger_book_id, a.account_type, a.code, a.name, a.normal_balance, j.transaction_currency;

CREATE VIEW ledger_cash_flow_report AS
SELECT a.ledger_book_id,
  j.cash_flow_activity,
  j.transaction_currency,
  sum(CASE p.side WHEN 'debit' THEN p.transaction_amount_minor ELSE -p.transaction_amount_minor END)::bigint AS transaction_amount_minor,
  sum(CASE p.side WHEN 'debit' THEN p.reporting_amount_minor ELSE -p.reporting_amount_minor END)::bigint AS reporting_amount_minor
FROM ledger_accounts a JOIN ledger_postings p ON p.account_id = a.id
JOIN journal_entries j ON j.id = p.journal_entry_id AND j.status = 'posted'
WHERE a.is_cash
GROUP BY a.ledger_book_id,
  j.cash_flow_activity,
  j.transaction_currency;

COMMENT ON TABLE ledger_books IS 'Generic accounting owner boundary; ticket 08 creates airline-owned books.';
COMMENT ON COLUMN ledger_postings.transaction_amount_minor IS 'Exact integer ISO minor units; reporting-only FX rounding lines use zero.';
COMMENT ON COLUMN ledger_postings.reporting_amount_minor IS 'Exact snapshot in reporting-currency minor units, rounded half-even.';
COMMENT ON TABLE exchange_rates IS 'Exact rational snapshots. No floating-point exchange arithmetic is permitted.';
