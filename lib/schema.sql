-- ===========================================================================
-- Recall — CockroachDB schema
--
-- The whole point of Recall: structured relational memory AND semantic vector
-- memory live in ONE strongly-consistent, always-on store. No Postgres+Pinecone
-- drift, no separate vector DB to keep in sync.
--
-- Uses CockroachDB Distributed Vector Indexing (VECTOR type + VECTOR INDEX).
-- Every derived fact/commitment cites the source memory row so recall is
-- trustworthy and never "invented".
-- ===========================================================================

-- Users of the app (the person doing the networking).
CREATE TABLE IF NOT EXISTS app_user (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email       STRING      NOT NULL UNIQUE,
  name        STRING,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A person the user has met / knows.
CREATE TABLE IF NOT EXISTS person (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name          STRING      NOT NULL,
  headline      STRING,                 -- short one-liner (e.g. "Founder @ Acme, ex-Stripe")
  company       STRING,
  location      STRING,
  last_interaction_at TIMESTAMPTZ,      -- drives "stale relationship" nudges
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX person_by_user (user_id, name),
  INDEX person_stale (user_id, last_interaction_at)
);

-- A raw memory: exactly what the user said/logged. This is the source of truth;
-- facts and commitments are derived from memories and always cite one.
CREATE TABLE IF NOT EXISTS memory (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  person_id   UUID        REFERENCES person(id) ON DELETE CASCADE,
  kind        STRING      NOT NULL DEFAULT 'note',  -- note | meeting | message | call
  content     STRING      NOT NULL,                 -- the raw text (never lost)
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX memory_by_user (user_id, occurred_at DESC),
  INDEX memory_by_person (person_id, occurred_at DESC)
);

-- Vector embedding of a memory for semantic recall.
-- Dimension must match BEDROCK_EMBED_MODEL_ID (Titan v2 = 1024).
CREATE TABLE IF NOT EXISTS memory_embedding (
  memory_id   UUID     NOT NULL PRIMARY KEY REFERENCES memory(id) ON DELETE CASCADE,
  user_id     UUID     NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  embedding   VECTOR(1024) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CockroachDB Distributed Vector Index for fast semantic KNN over embeddings.
CREATE VECTOR INDEX IF NOT EXISTS memory_embedding_idx
  ON memory_embedding (embedding);

-- A typed fact about a person, derived from a memory (cited via source_memory_id).
CREATE TABLE IF NOT EXISTS fact (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  person_id        UUID        NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  attribute        STRING      NOT NULL,   -- e.g. "role", "interest", "kid_name", "hiring_for"
  value            STRING      NOT NULL,
  source_memory_id UUID        REFERENCES memory(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX fact_by_person (person_id, attribute)
);

-- A commitment / follow-up the user owes (or is owed). Drives the "Today" feed.
CREATE TABLE IF NOT EXISTS commitment (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  person_id        UUID        REFERENCES person(id) ON DELETE CASCADE,
  description      STRING      NOT NULL,   -- "intro Sarah to the CTO"
  due_at           TIMESTAMPTZ,            -- when the follow-up is due (nullable)
  status           STRING      NOT NULL DEFAULT 'open',  -- open | done | snoozed | dismissed
  source_memory_id UUID        REFERENCES memory(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX commitment_today (user_id, status, due_at)
);

-- Append-only audit log (security requirement: who did what, when).
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        REFERENCES app_user(id) ON DELETE SET NULL,
  action      STRING      NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX audit_by_user (user_id, created_at DESC)
);
