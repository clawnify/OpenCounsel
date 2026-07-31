-- Open Counsel — schema.
--
-- No org_id column anywhere, deliberately: the platform provisions a separate
-- D1 database per deployed app, so the database itself is the tenant boundary.
-- A column repeating one constant value would add no isolation, and filtering
-- on the org header would lock out the `agent-browser` caller (for which it is
-- null) — the agent driving the review grid in a real browser.

create table if not exists matters (
  id          text primary key,
  name        text not null,
  client      text not null default '',
  description text not null default '',
  status      text not null default 'open',           -- open | closed
  created_by  text not null default '',               -- platform user id, for the audit trail
  created_at  text not null default (datetime('now')),
  updated_at  text not null default (datetime('now'))
);
create index if not exists idx_matters_status on matters (status, created_at desc);

-- One uploaded file. The bytes live in R2 under r2_key; the *text* lives in
-- document_pages, because that is what citations are checked against.
create table if not exists documents (
  id             text primary key,
  matter_id      text not null references matters (id) on delete cascade,
  name           text not null,
  r2_key         text not null,
  mime           text not null default '',
  size_bytes     integer not null default 0,
  page_count     integer not null default 0,
  -- What page_no means for this document. PDFs have real pages; DOCX and plain
  -- text do not, so they are split into fixed-size blocks and page_no is the
  -- block index. Callers must not assume "page 3" means a printed page 3.
  locator_kind   text not null default 'page',        -- page | block
  extract_status text not null default 'pending',     -- pending | ready | failed
  extract_error  text not null default '',
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_documents_matter on documents (matter_id, created_at desc);

-- The citation substrate. Text is stored verbatim (not normalised) so it can be
-- shown to a human as it appears in the file; verification normalises on read.
create table if not exists document_pages (
  document_id text not null references documents (id) on delete cascade,
  page_no     integer not null,
  text        text not null default '',
  primary key (document_id, page_no)
);

-- A tabular review: one grid over the matter's documents.
create table if not exists reviews (
  id         text primary key,
  matter_id  text not null references matters (id) on delete cascade,
  name       text not null,
  status     text not null default 'draft',           -- draft | running | complete
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
create index if not exists idx_reviews_matter on reviews (matter_id, created_at desc);

-- A column is a question asked of every document in the review.
create table if not exists review_columns (
  id        text primary key,
  review_id text not null references reviews (id) on delete cascade,
  position  integer not null default 0,
  key       text not null,                            -- stable handle the agent writes against
  question  text not null,                            -- the grid header; short
  -- The detailed instruction for whoever answers the column. Imported column
  -- sets put their real substance here — several sentences of what to look for
  -- — so this is sent to the agent alongside the question, never just stored.
  hint      text not null default '',
  type      text not null default 'text',             -- text | enum | date | money | percentage | bulleted_list | boolean
  options   text not null default ''                  -- comma-separated, enum only
);
create unique index if not exists idx_columns_key on review_columns (review_id, key);

-- One answer for one document under one column.
--
-- status is the whole point of this app:
--   answered  — value backed by a quote that was found in the cited page
--   not_found — the document genuinely does not answer the question
--   rejected  — a quote was offered and could NOT be located; the value is not
--               shown as an answer, because an unverifiable citation is worse
--               than a blank cell in this domain
create table if not exists review_cells (
  id              text primary key,
  review_id       text not null references reviews (id) on delete cascade,
  document_id     text not null references documents (id) on delete cascade,
  column_id       text not null references review_columns (id) on delete cascade,
  value           text not null default '',
  quote           text not null default '',
  page_no         integer,
  status          text not null default 'answered',   -- answered | not_found | rejected
  rejected_reason text not null default '',
  updated_at      text not null default (datetime('now'))
);
create unique index if not exists idx_cells_slot on review_cells (review_id, document_id, column_id);
create index if not exists idx_cells_review on review_cells (review_id, status);

-- A saved column set. This is what turns one lawyer's proven prompt into
-- something a junior runs in one click.
-- A workflow imported from a bundled pack is a *copy*, not a reference: review
-- criteria are the firm's work product, so an upstream revision must never
-- retroactively change what a matter was reviewed against. These columns record
-- where the copy came from, which is also what the upstream MIT licence and its
-- PROVENANCE.md require us to preserve.
create table if not exists workflows (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  columns_json text not null default '[]',
  source_pack  text not null default '',              -- bundled pack id, '' when hand-written
  source_url   text not null default '',
  author       text not null default '',
  license      text not null default '',
  created_at   text not null default (datetime('now'))
);
create index if not exists idx_workflows_created on workflows (created_at desc);

-- A proposed set of changes to one document, and the Word redline it produces.
--
-- This is the other half of the app's bargain. A review answers "what does this
-- contract say"; a revision answers "what should it say instead" — and it has to
-- leave the negotiation in the format the negotiation actually happens in, which
-- is a Word file with tracked changes that opposing counsel can accept or reject
-- clause by clause. A list of suggestions in a web app is not that.
--
-- It is a record, not a job: the edits are reviewable before anything is built,
-- the lawyer decides which ones go in, and the produced file is kept so the
-- matter still has its redline weeks later. Only .docx documents can carry one —
-- a PDF has no revision marks to write.
create table if not exists revisions (
  id              text primary key,
  document_id     text not null references documents (id) on delete cascade,
  name            text not null default '',
  status          text not null default 'draft',     -- draft | building | ready | failed
  -- Word shows this against every tracked change; it is who the other side sees.
  author          text not null default '',
  redline_key     text not null default '',          -- R2 key of the produced .docx
  redline_size    integer not null default 0,
  -- What the comparer counted. Null means it could not tell, which must not look
  -- the same as zero.
  revisions_found integer,
  error           text not null default '',
  created_by      text not null default '',
  created_at      text not null default (datetime('now')),
  updated_at      text not null default (datetime('now'))
);
create index if not exists idx_revisions_document on revisions (document_id, created_at desc);

-- One change: replace `anchor` with `replacement`, because `reason`.
--
-- status carries both verdicts, which are not the same question:
--   proposed  — the anchor was located, uniquely, in the extracted text
--   rejected  — it was not (missing, or matching in more than one place, which
--               would mean rewriting a clause nobody chose)
--   excluded  — real, but the reviewer decided against it
--   applied   — it landed in the actual .docx
--   unapplied — it did not, and the redline was built without it
create table if not exists revision_edits (
  id              text primary key,
  revision_id     text not null references revisions (id) on delete cascade,
  position        integer not null default 0,
  anchor          text not null,
  replacement     text not null default '',          -- '' deletes the anchor
  reason          text not null default '',
  page_no         integer,
  status          text not null default 'proposed',
  rejected_reason text not null default ''
);
create index if not exists idx_revision_edits on revision_edits (revision_id, position);

-- Which agent runs reviews. A single row by construction: the choice is a
-- property of the deployment, not of any matter. Left empty when the org has
-- one agent — the platform resolves it — and only has to be set when there are
-- several, because then the platform refuses to guess.
create table if not exists agent_config (
  id         integer primary key check (id = 1),
  server_id  text not null default '',
  updated_at text default (datetime('now'))
);
