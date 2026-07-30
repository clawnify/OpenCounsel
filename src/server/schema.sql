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
  question  text not null,
  hint      text not null default '',
  type      text not null default 'text',             -- text | enum | date | money | boolean
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
create table if not exists workflows (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  columns_json text not null default '[]',
  created_at   text not null default (datetime('now'))
);
create index if not exists idx_workflows_created on workflows (created_at desc);
