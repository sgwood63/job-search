-- Job Search OB1 Extension Schema
-- Run against the OB1 PostgreSQL instance after base OB1 setup.
-- Assumes the base `thoughts` table already exists (from OB1 core schema).
--
-- Apply with:
--   kubectl exec -n openbrain openbrain-0 -c postgres -- \
--     psql -U postgres -d openbrain < integrations/ob1/job-search-schema.sql

-- ---------------------------------------------------------------------------
-- js_files: object store references
-- Stores metadata + logical path for every file in the object store.
-- No file bytes are stored here — content lives in MinIO or Supabase Storage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_files (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key  text        UNIQUE NOT NULL,  -- logical path, e.g. 'applications/2026-05-15-co/notes.md'
  bucket       text        NOT NULL DEFAULT 'job-search',
  content_type text        NOT NULL,         -- 'text/markdown', 'application/pdf', etc.
  file_size    int,
  thought_id   bigint      REFERENCES thoughts(id) ON DELETE SET NULL,  -- semantic ref for text files
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS js_files_key_idx    ON js_files(storage_key);
CREATE INDEX IF NOT EXISTS js_files_prefix_idx ON js_files(storage_key text_pattern_ops);
CREATE INDEX IF NOT EXISTS js_files_thought_idx ON js_files(thought_id) WHERE thought_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- js_applicant: core applicant profile (one row)
-- Source of truth for identity, location criteria, compensation, deal-breakers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_applicant (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name      text        NOT NULL,
  email             text,
  location_city     text,
  location_state    text,
  remote_preference text        CHECK (remote_preference IN ('remote-only', 'hybrid-ok', 'onsite-ok')),
  travel_max_pct    int         CHECK (travel_max_pct BETWEEN 0 AND 100),
  comp_floor        int,
  comp_target       int,
  comp_currency     text        NOT NULL DEFAULT 'USD',
  hard_stop_domains text[],     -- domains to always reject, e.g. ARRAY['fintech','crypto']
  deal_breakers     jsonb,      -- structured list of deal-breaker conditions
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- js_experience: work history and achievements
-- Replaces EXPERIENCE-REFERENCE.md as the authoritative fact sheet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_experience (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company             text        NOT NULL,
  title               text        NOT NULL,
  start_date          date,
  end_date            date,       -- NULL means current role
  employment_type     text        CHECK (employment_type IN ('full-time', 'contract', 'consulting', 'part-time')),
  role_classification text        CHECK (role_classification IN (
                                    'include-standard', 'include-condensed', 'earlier-career', 'exclude'
                                  )),
  description         text,
  achievements        jsonb,      -- array of {bullet: text, profile_tags: text[], verified: bool}
  thought_id          bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  sort_order          int         NOT NULL DEFAULT 0,  -- controls resume ordering (ascending)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS js_experience_sort_idx ON js_experience(sort_order);

-- ---------------------------------------------------------------------------
-- js_profiles: role profiles
-- Replaces PROFILES-QUICK-REFERENCE.md rows as the source of truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        UNIQUE NOT NULL,  -- 'presales-se', 'ai-governance-se', etc.
  display_name        text        NOT NULL,
  positioning         text,                         -- one-paragraph strategy statement
  target_seniority    text,
  jd_signal_keywords  text[],
  avoid_when          text,
  hard_stops          text,
  search_query        text,                         -- OR-query used by /ingest
  active              bool        NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- js_companies: company directory (lazy-created as applications are processed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_companies (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  slug             text        UNIQUE NOT NULL,  -- url-safe identifier
  industry         text,
  size_range       text        CHECK (size_range IN ('startup', 'mid-market', 'enterprise', 'public')),
  remote_policy    text,
  website          text,
  glassdoor_rating numeric(2,1) CHECK (glassdoor_rating BETWEEN 1.0 AND 5.0),
  domain_tags      text[],     -- e.g. ARRAY['ai','saas','fintech']
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- js_applications: application pipeline
-- Replaces application-tracker.md as the authoritative pipeline state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_applications (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        REFERENCES js_companies(id) ON DELETE SET NULL,
  company_name_raw  text,       -- fallback when company record not yet created
  role_title        text        NOT NULL,
  profile_id        uuid        REFERENCES js_profiles(id) ON DELETE SET NULL,
  source_url        text,
  folder_prefix     text,       -- object store prefix, e.g. 'applications/2026-05-15-company-role/'
  status            text        NOT NULL DEFAULT 'pending-review'
                                CHECK (status IN (
                                  'pending-review', 'resume-ready', 'applied',
                                  'interview-scheduled', 'interviewed', 'exercise',
                                  'offer', 'closed', 'not-interested'
                                )),
  status_detail     text,       -- e.g. 'Rejected after phone screen'
  applied_date      date,
  follow_up_date    date,
  priority          int         NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),  -- 1=low 2=normal 3=high
  jd_thought_id     bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  notes_thought_id  bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  resume_key        text,       -- js_files.storage_key for the resume PDF
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS js_applications_status_idx      ON js_applications(status);
CREATE INDEX IF NOT EXISTS js_applications_follow_up_idx   ON js_applications(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS js_applications_company_idx     ON js_applications(company_id);
CREATE INDEX IF NOT EXISTS js_applications_profile_idx     ON js_applications(profile_id);

-- ---------------------------------------------------------------------------
-- js_interviews: interview tracking (currently buried in notes.md sections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_interviews (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid        NOT NULL REFERENCES js_applications(id) ON DELETE CASCADE,
  stage             text        CHECK (stage IN (
                                  'recruiter-screen', 'hiring-manager', 'technical',
                                  'panel', 'final', 'offer-discussion', 'other'
                                )),
  interview_type    text,       -- 'video' | 'phone' | 'onsite' | 'async'
  scheduled_at      timestamptz,
  completed_at      timestamptz,
  interviewer_name  text,
  interviewer_title text,
  pre_notes         text,       -- preparation notes written before the call
  post_notes        text,       -- debrief notes written after the call
  rating            int         CHECK (rating BETWEEN 1 AND 5),  -- self-assessment
  thought_id        bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS js_interviews_application_idx ON js_interviews(application_id);
CREATE INDEX IF NOT EXISTS js_interviews_scheduled_idx   ON js_interviews(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- js_contacts: recruiters, hiring managers, warm connections
-- Replaces APPLICANT-MEMORY.md warm connections table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_contacts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  company_id        uuid        REFERENCES js_companies(id) ON DELETE SET NULL,
  title             text,
  email             text,
  linkedin_url      text,
  relationship_type text        CHECK (relationship_type IN (
                                  'recruiter', 'hiring-manager', 'warm-connection', 'network'
                                )),
  last_contact_at   date,
  follow_up_date    date,
  notes             text,
  thought_id        bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS js_contacts_company_idx ON js_contacts(company_id);

-- ---------------------------------------------------------------------------
-- js_search_runs: job search audit log
-- Replaces search-log.csv as the authoritative search history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_search_runs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid        REFERENCES js_profiles(id) ON DELETE SET NULL,
  query               text,
  pages_fetched       int         NOT NULL DEFAULT 0,
  total_results       int         NOT NULL DEFAULT 0,
  new_after_dedup     int         NOT NULL DEFAULT 0,
  screened            int         NOT NULL DEFAULT 0,
  fit_count           int         NOT NULL DEFAULT 0,
  run_at              timestamptz NOT NULL DEFAULT now(),
  summary_key         text,       -- js_files.storage_key for the per-run summary .md
  summary_thought_id  bigint      REFERENCES thoughts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS js_search_runs_profile_idx ON js_search_runs(profile_id);
CREATE INDEX IF NOT EXISTS js_search_runs_run_at_idx  ON js_search_runs(run_at DESC);

-- ---------------------------------------------------------------------------
-- auto-updated updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION js_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['js_files','js_experience','js_profiles','js_companies',
                              'js_applications','js_interviews','js_contacts'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I;
       CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION js_set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;
