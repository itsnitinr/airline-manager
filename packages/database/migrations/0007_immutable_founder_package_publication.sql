DROP TRIGGER founder_package_versions_immutable ON founder_package_versions;
DROP TRIGGER founder_package_options_immutable ON founder_package_options;

ALTER TABLE founder_package_versions DROP CONSTRAINT founder_package_versions_status_check;
ALTER TABLE founder_package_versions ADD CONSTRAINT founder_package_versions_status_check
  CHECK (status IN ('draft', 'active', 'retired'));

CREATE FUNCTION guard_founder_package_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'published founder package versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF (OLD.id, OLD.version, OLD.world_ruleset_id, OLD.created_at)
    IS DISTINCT FROM (NEW.id, NEW.version, NEW.world_ruleset_id, NEW.created_at)
    OR NEW.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'founder package publication may only activate a draft' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founder_package_versions_immutable
  BEFORE UPDATE OR DELETE ON founder_package_versions
  FOR EACH ROW EXECUTE FUNCTION guard_founder_package_version();

CREATE FUNCTION guard_founder_package_option() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_version_id uuid;
BEGIN
  target_version_id := COALESCE(NEW.package_version_id, OLD.package_version_id);
  IF EXISTS (SELECT 1 FROM founder_package_versions WHERE id = target_version_id AND status <> 'draft') THEN
    RAISE EXCEPTION 'published founder package options are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER founder_package_options_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON founder_package_options
  FOR EACH ROW EXECUTE FUNCTION guard_founder_package_option();

COMMENT ON TABLE founder_package_versions IS
  'Drafts may be assembled once; active and retired founder package versions are immutable.';
