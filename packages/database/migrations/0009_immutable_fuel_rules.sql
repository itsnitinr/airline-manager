CREATE FUNCTION guard_active_fuel_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' THEN
    RAISE EXCEPTION 'active fuel rules are immutable; publish a new version' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER active_fuel_rules_immutable
  BEFORE UPDATE OR DELETE ON fuel_ruleset_versions
  FOR EACH ROW EXECUTE FUNCTION guard_active_fuel_rules();

CREATE FUNCTION guard_active_fuel_capacity_tiers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_version_id uuid;
BEGIN
  target_version_id := COALESCE(NEW.fuel_ruleset_version_id, OLD.fuel_ruleset_version_id);
  IF EXISTS (SELECT 1 FROM fuel_ruleset_versions WHERE id = target_version_id AND status = 'active') THEN
    IF TG_OP = 'INSERT' AND EXISTS (
      SELECT 1 FROM fuel_capacity_tiers
      WHERE fuel_ruleset_version_id = NEW.fuel_ruleset_version_id AND tier = NEW.tier
        AND capacity_kg = NEW.capacity_kg AND upgrade_price_minor = NEW.upgrade_price_minor
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'active fuel capacity tiers are immutable; publish a new version' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER active_fuel_capacity_tiers_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON fuel_capacity_tiers
  FOR EACH ROW EXECUTE FUNCTION guard_active_fuel_capacity_tiers();
