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

1. **Get the shape.** `GET /api/reviews/{id}` returns the columns (each has a
   `key` — that is what you write answers against) and how much of the grid is
   filled.
2. **List the documents.** `GET /api/matters/{matter_id}/documents`. Skip any
   whose `extract_status` is not `ready`; there is no text to cite.
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

## Pages

- `/matters` — the matter list.
- `/matters/{id}` — documents and reviews for one matter.
- `/reviews/{id}` — **the review grid.** Screenshot-friendly; this is the page
  to show a user when reporting that a review is done.
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
