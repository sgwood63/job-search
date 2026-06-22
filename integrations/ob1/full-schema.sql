-- =============================================================================
-- full-schema.sql — Authoritative three-layer schema for job-search + OB1
--
-- USAGE (fresh deploy):
--   kubectl exec -n openbrain openbrain-0 -c db -- \
--     psql -U postgres -d openbrain < integrations/ob1/full-schema.sql
--
-- USAGE (existing deploy — idempotent, safe to re-run):
--   Same command above. All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--
-- LAYERS:
--   Layer 1 — OB1 core: thoughts table + pgvector extension + match_thoughts()
--             Source: openbrain.yml ConfigMap openbrain-init-sql (keep in sync)
--             Note: openbrain.yml ConfigMap stays as-is (PostgreSQL needs it on
--             first startup before this file can be applied). This layer is a no-op
--             on existing deployments where the ConfigMap has already run.
--
--   Layer 2 — Knowledge graph: entities + edges tables (minimal, no Supabase RLS)
--             Derived from OB1/schemas/entity-extraction/schema.sql.
--             Includes ONLY entities + edges + their indexes — none of the Supabase-
--             specific tables (thought_entities, entity_extraction_queue,
--             consolidation_log), triggers, RLS policies, or GRANT statements.
--             The entity extraction worker is not deployed in this stack.
--
--   Layer 3 — Job search: js_* tables
--             Source: job-search-schema.sql (unchanged; that file is still the
--             authoritative definition of js_* tables for incremental changes).
-- =============================================================================

-- =============================================================================
-- LAYER 1 — OB1 Core (thoughts table + pgvector)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS thoughts (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata ON thoughts USING GIN (metadata);

CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 10,
    filter JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.content,
        t.metadata,
        (1 - (t.embedding <=> query_embedding))::FLOAT AS similarity,
        t.created_at
    FROM thoughts t
    WHERE 1 - (t.embedding <=> query_embedding) >= match_threshold
    ORDER BY t.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- =============================================================================
-- LAYER 2 — Knowledge Graph (entities + edges, minimal — no Supabase RLS)
-- Derived from OB1/schemas/entity-extraction/schema.sql.
-- Omitted: prerequisite check, thought_entities, entity_extraction_queue,
--          consolidation_log, auto-queue trigger, RLS policies, GRANTs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.entities (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,         -- person, project, topic, tool, organization, place
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,     -- lowercase, trimmed, for dedup
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, normalized_name)
);

CREATE TABLE IF NOT EXISTS public.edges (
  id BIGSERIAL PRIMARY KEY,
  from_entity_id BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  to_entity_id BIGINT NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  support_count INT NOT NULL DEFAULT 1,
  confidence NUMERIC(3,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  thought_id TEXT,                   -- optional link to thoughts.id (stored as text to match id::text cast)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_entity_id, to_entity_id, relation)
);

-- Thought-entity links: evidence-bearing links from thoughts to entities.
-- Note: thought_id is BIGINT here (matching thoughts.id BIGSERIAL) — not UUID
-- as in OB1's Supabase schema. The job-search stack uses BIGSERIAL thought ids.
CREATE TABLE IF NOT EXISTS public.thought_entities (
  thought_id  BIGINT  NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  entity_id   BIGINT  NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  mention_role TEXT   NOT NULL DEFAULT 'mentioned',
  confidence  NUMERIC(3,2),
  source      TEXT    NOT NULL DEFAULT 'job_search',
  evidence    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (thought_id, entity_id, mention_role)
);

CREATE INDEX IF NOT EXISTS idx_entities_type       ON public.entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_normalized ON public.entities(normalized_name);
CREATE INDEX IF NOT EXISTS idx_edges_from          ON public.edges(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_to            ON public.edges(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation      ON public.edges(relation);
CREATE INDEX IF NOT EXISTS idx_thought_entities_entity ON public.thought_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_thought_entities_thought ON public.thought_entities(thought_id);

-- =============================================================================
-- LAYER 3 — Job Search Extension (js_* tables)
-- Source: job-search-schema.sql (that file is the authoritative definition;
-- changes to js_* tables should be made there first, then reflected here).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- js_files: object store references
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_files (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key      text        UNIQUE NOT NULL,
  bucket           text        NOT NULL DEFAULT 'job-search',
  content_type     text        NOT NULL,
  file_size        int,
  thought_id       bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  thought_category text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE js_files ADD COLUMN IF NOT EXISTS thought_category text;
CREATE INDEX IF NOT EXISTS js_files_key_idx      ON js_files(storage_key);
CREATE INDEX IF NOT EXISTS js_files_prefix_idx   ON js_files(storage_key text_pattern_ops);
CREATE INDEX IF NOT EXISTS js_files_thought_idx  ON js_files(thought_id) WHERE thought_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS js_files_category_idx ON js_files(thought_category) WHERE thought_category IS NOT NULL;

-- ---------------------------------------------------------------------------
-- js_applicant: core applicant profile (one row)
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
  hard_stop_domains text[],
  deal_breakers     jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- js_experience: work history and achievements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_experience (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company             text        NOT NULL,
  title               text        NOT NULL,
  start_date          date,
  end_date            date,
  employment_type     text        CHECK (employment_type IN ('full-time', 'contract', 'consulting', 'part-time')),
  role_classification text        CHECK (role_classification IN (
                                    'include-standard', 'include-condensed', 'earlier-career', 'exclude'
                                  )),
  description         text,
  achievements        jsonb,
  thought_id          bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  sort_order          int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS js_experience_sort_idx ON js_experience(sort_order);

-- ---------------------------------------------------------------------------
-- js_profiles: role profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        UNIQUE NOT NULL,
  display_name        text        NOT NULL,
  positioning         text,
  target_seniority    text,
  jd_signal_keywords  text[],
  avoid_when          text,
  hard_stops          text,
  search_query        text,
  active              bool        NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- js_companies: company directory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_companies (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  slug             text        UNIQUE NOT NULL,
  industry         text,
  size_range       text        CHECK (size_range IN ('startup', 'mid-market', 'enterprise', 'public')),
  remote_policy    text,
  website          text,
  glassdoor_rating numeric(2,1) CHECK (glassdoor_rating BETWEEN 1.0 AND 5.0),
  domain_tags      text[],
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- js_applications: application pipeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_applications (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        REFERENCES js_companies(id) ON DELETE SET NULL,
  company_name_raw  text,
  role_title        text        NOT NULL,
  profile_id        uuid        REFERENCES js_profiles(id) ON DELETE SET NULL,
  source_url        text,
  folder_prefix     text,
  status            text        NOT NULL DEFAULT 'pending-review'
                                CHECK (status IN (
                                  'pending-review', 'resume-ready', 'applied',
                                  'interview-scheduled', 'interviewed', 'exercise',
                                  'offer', 'closed', 'not-interested'
                                )),
  status_detail     text,
  applied_date      date,
  follow_up_date    date,
  priority          int         NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
  jd_thought_id     bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  notes_thought_id  bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  resume_key        text,
  domain_connection text,
  domain_tags       text[],
  jd_requirements   jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE js_applications ADD COLUMN IF NOT EXISTS domain_connection text;
ALTER TABLE js_applications ADD COLUMN IF NOT EXISTS domain_tags       text[];
ALTER TABLE js_applications ADD COLUMN IF NOT EXISTS jd_requirements   jsonb;
CREATE INDEX IF NOT EXISTS js_applications_status_idx      ON js_applications(status);
CREATE INDEX IF NOT EXISTS js_applications_follow_up_idx   ON js_applications(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS js_applications_company_idx     ON js_applications(company_id);
CREATE INDEX IF NOT EXISTS js_applications_profile_idx     ON js_applications(profile_id);

-- ---------------------------------------------------------------------------
-- js_interviews: interview tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_interviews (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid        NOT NULL REFERENCES js_applications(id) ON DELETE CASCADE,
  stage             text        CHECK (stage IN (
                                  'recruiter-screen', 'hiring-manager', 'technical',
                                  'panel', 'final', 'offer-discussion', 'other'
                                )),
  interview_type    text,
  scheduled_at      timestamptz,
  completed_at      timestamptz,
  interviewer_name  text,
  interviewer_title text,
  pre_notes         text,
  post_notes        text,
  rating            int         CHECK (rating BETWEEN 1 AND 5),
  thought_id        bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS js_interviews_application_idx ON js_interviews(application_id);
CREATE INDEX IF NOT EXISTS js_interviews_scheduled_idx   ON js_interviews(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- js_contacts: recruiters, hiring managers, warm connections
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
  summary_key         text,
  summary_thought_id  bigint      REFERENCES thoughts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS js_search_runs_profile_idx ON js_search_runs(profile_id);
CREATE INDEX IF NOT EXISTS js_search_runs_run_at_idx  ON js_search_runs(run_at DESC);

-- ---------------------------------------------------------------------------
-- js_ingested_positions: audit trail of every job position encountered
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_ingested_positions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url      text,
  company_name    text,
  role_title      text,
  profile_slug    text        REFERENCES js_profiles(slug) ON DELETE SET NULL,
  search_run_id   uuid        REFERENCES js_search_runs(id) ON DELETE SET NULL,
  application_id  uuid        REFERENCES js_applications(id) ON DELETE SET NULL,
  outcome         text        NOT NULL CHECK (outcome IN ('fit','no-fit','duplicate','fetch-failed')),
  no_fit_reason   text,
  is_repost       bool        NOT NULL DEFAULT false,
  first_seen_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_url_unique
  ON js_ingested_positions(source_url) WHERE source_url IS NOT NULL AND outcome != 'duplicate';
CREATE INDEX IF NOT EXISTS idx_ingested_company_role
  ON js_ingested_positions(lower(company_name), lower(role_title));
CREATE INDEX IF NOT EXISTS idx_ingested_profile
  ON js_ingested_positions(profile_slug) WHERE profile_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingested_created ON js_ingested_positions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingested_search_run
  ON js_ingested_positions(search_run_id) WHERE search_run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- js_chunks: H2-section-level chunks for text files (Phase 2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS js_chunks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key     text        NOT NULL,
  file_id         uuid        REFERENCES js_files(id) ON DELETE CASCADE,
  section_title   text,
  section_index   int         NOT NULL,
  content         text        NOT NULL,
  char_count      int,
  thought_id      bigint      REFERENCES thoughts(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_storage_key ON js_chunks(storage_key);
CREATE INDEX IF NOT EXISTS idx_chunks_file_id     ON js_chunks(file_id) WHERE file_id IS NOT NULL;

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

-- ---------------------------------------------------------------------------
-- Phase 3: Knowledge Graph Edge Indexes (job-search query patterns)
-- Composite indexes on public.edges for company→requires→skill and
-- skill←demonstrates←achievement traversal patterns.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_edges_relation_from ON public.edges(relation, from_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation_to   ON public.edges(relation, to_entity_id);
