# Open Counsel — agent guide

## What you do, and what the app does

**You read. The app remembers, and checks your work.**

- **You** read documents and answer the review's questions. Long prose, real
  judgment, one document at a time.
- **The app** stores the documents, extracts their text, holds the grid — and
  **verifies every citation you submit** before it will show it as an answer.

**Never answer without a quote you copied from the document.** The app locates
your quote in the extracted text. If it isn't there, the cell is stored as
`rejected`, rendered to the user as *unresolved*, and your answer is not shown.
A confident invented answer costs you the cell; there is no way to talk past the
check.

**Never guess when a document is silent.** Send `{"status": "not_found"}` for
that cell. This is a correct answer, not a failure — "the lease says nothing
about assignment" is exactly what a diligence reviewer needs to know.

**Never extract text yourself.** Do not open the PDF with your own tools. The
app already extracted it, and its page numbering is what citations are checked
against — text you read another way will disagree with it and your quotes will
be rejected.

## Running a review

1. **Get the shape.** `GET /api/reviews/{id}` returns the columns and how much
   of the grid is filled. Each column has a `key` (what you write answers
   against), a short `question` (the grid header) and a **`hint`** — read the
   hint. On imported column sets the question is a two-word label like
   "Remedies" and the hint is the actual instruction: which clauses to look at,
   what to note, what counts as an answer. Answering from the label alone is
   how a column comes back technically true and useless.
2. **List the documents.** `GET /api/matters/{matter_id}/documents`.
   - `ready` — has text, cite away.
   - `pending` — the file is stored but its text was never read, usually because
     the uploader's tab closed mid-way. **`POST /api/documents/{id}/extract`**
     and carry on; it is idempotent and safe to repeat.
   - `failed` — no text layer (usually a scan). Skip it and tell the user it
     needs OCR. Do not try to read it another way.
3. **Read one document fully.** `GET /api/documents/{id}/pages?from_page=1&limit=5`,
   then keep going. **Read every page** — governing law is often on page 1 but
   the term and termination clauses are near the end, and answering from the
   first page is the commonest way to get a whole column wrong.
4. **Answer every column for that document**, then `POST /api/reviews/{id}/cells`
   with all of its cells in one call. Post per document rather than at the end,
   so the user watches the grid fill.
5. **Handle the rejections** in the response before moving on (see below).
6. **Repeat** for each document.

Note `locator_kind` on the document: `page` means real PDF pages; `block` means
a Word or text file split into numbered blocks. Cite the number the app gave
you either way.

## Proposing changes to a contract

The other half of the app. A review reads a document; a **revision** changes one
and produces a Word file with tracked changes the other side can accept or
reject clause by clause.

Only `.docx` documents. Tracked changes are an OOXML feature — a PDF has no
revision marks to write, so redline the Word file the PDF came from.

```jsonc
// POST /api/documents/{id}/revisions
{
  "name": "Our position, round 1",
  "edits": [
    { "anchor": "the aggregate liability of the Supplier shall be unlimited",
      "replacement": "the aggregate liability of the Supplier shall not exceed the fees paid in the preceding twelve months",
      "reason": "Unlimited liability is outside our mandate." }
  ]
}
```

**The anchor must identify exactly one passage.** This is the one rule that is
*stricter* than citation checking, and the one you will get wrong from good
instincts. Citing a covenant that appears in four schedules is fine — you read
it on the page you cited. *Replacing* it would rewrite three clauses nobody
chose, so a second match is rejected, never applied to the first hit. Include
the clause number or the words either side until the anchor is unique.

- **Stay inside one paragraph.** An anchor spanning a paragraph break cannot be
  replaced in place.
- **To delete a phrase, anchor a neighbouring word too** and give that word back
  as the replacement: `"Personnel engaged hereunder"` → `"Personnel"`. Matching
  ignores whitespace, so a bare anchor leaves the spaces that surrounded it.
- **Change only what was asked for.** Everything you do not anchor comes through
  byte-identical, and that is what makes the redline readable. Do not rewrite
  the document.

Rejections come back the same way cells do — 422, per-edit reasons, accepted
edits still saved, so re-send only the failures:

```jsonc
{ "revision": { … }, "edits": [
  { "anchor": "…", "status": "rejected",
    "rejected_reason": "anchor appears more than once, so replacing it would rewrite a clause nobody chose. …" } ] }
```

Then **stop and tell the user what you proposed and why.** A human approves the
edits (`PATCH /api/revisions/{id}/edits/{edit_id}` with `{"include": false}` to
drop one) and builds the file. `POST /api/revisions/{id}/build` is yours to call
only if they asked you to go all the way; it takes seconds to minutes and
returns each edit's final verdict — `applied`, or `unapplied` with a reason.

Never fetch `/api/revisions/{id}/download` — that is the binary, for a human.

## Pages

- `/matters` — the matter list.
- `/matters/{id}` — documents and reviews for one matter.
- `/reviews/{id}` — **the review grid.** Screenshot-friendly; this is the page
  to show a user when reporting that a review is done.
- `/documents/{id}/redline` — proposed changes and the built redline. Show this
  when reporting that you have proposed edits.
- `/workflows` — saved column sets.

## API anchors

Full shapes are in `/llms.txt` and `/api/openapi.json` — read those rather than
guessing. The two calls you will write most:

```jsonc
// POST /api/reviews/{id}/cells   — up to 100 cells per call
{
  "cells": [
    { "document_id": "…", "column": "governing_law",
      "value": "New York",
      "quote": "governed by and construed in accordance with the laws of the State of New York",
      "page": 4 },
    { "document_id": "…", "column": "assignment", "status": "not_found" }
  ]
}
```

```
GET /api/documents/{id}/pages?from_page=1&limit=5   — how you read a document
```

Others worth knowing: `POST /api/matters/{id}/reviews` (start a review, from
`columns` or a `workflow_id`), `POST /api/workflows` with `from_review_id` (save
a review's columns for reuse).

**Before writing columns yourself, look at the library.** `GET /api/workflow-packs`
lists bundled column sets written by practitioners — NDA, credit agreement,
lease, SPA, shareholder agreement, employment and more. If the user asks for a
review of a document type one of them covers,
`POST /api/workflow-packs/{id}/import` and start the review from that workflow.
Columns you invent will be thinner than the ones already there.

Respect the `type` on each column: `bulleted_list` wants a short list, `money`
a monetary amount, `date` a date. The grid renders them accordingly.

## How to read failures

`POST …/cells` returns **422** when any cell failed verification — but accepted
cells in the same batch were still stored, so only re-send the failures.

```jsonc
{ "accepted": 3,
  "rejected": [
    { "document_id": "…", "column": "term",
      "reason": "quote was not found on page 2", "found_on_page": 7 }
  ] }
```

- **`found_on_page` is present** → your quote is real, your page number wasn't.
  Re-send the same quote with that page. Do not re-read the document.
- **"does not appear anywhere in this document's extracted text"** → the quote
  is wrong. Go back to the pages and copy the sentence character for character;
  do not paraphrase, and do not stitch two sentences together.
- **"quote is N characters"** → too short to identify a passage. Quote the whole
  clause, not the answer word.
- **"no column with key …"** → you invented a key. The valid ones came from
  `GET /api/reviews/{id}`.
- **`extract_status: failed`** on a document → it has no text layer (usually a
  scan). Tell the user it needs OCR; do not try to read it another way.

## Cost discipline

Nothing here bills a vendor — no model keys, no per-page fees. The only real
cost is your own context, so:

- Read pages in batches of ~5, not the whole document in one call.
- Never fetch `/api/reviews/{id}/export.csv`; it is an unpaginated human
  download. Use `/api/reviews/{id}/cells` to inspect answers.
- Never fetch `/api/documents/{id}/file` — that is the raw binary.
