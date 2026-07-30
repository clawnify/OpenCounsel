<img src="readme-banner.png" alt="Open Counsel" width="100%">

# Open Counsel

Matter-scoped document review for legal teams — where a citation is **checked, not promised**.

Upload the contracts, write the questions once, and let your AI agent fill a spreadsheet-style grid across every document. Every answer must carry a quote copied from the source, and the app locates that quote in the document's own text before it will display it as an answer. A quote it cannot find is shown as **unresolved**, never as a result.

An open-source app template provided by [Clawnify.com](https://clawnify.com).

## Why this exists

Ask any capable model to "review these 40 NDAs and cite your sources" and most of the answers will be right. The problem is the rest: a fluent, plausible answer with a page number attached, quoting a sentence that does not exist. In a diligence pack that is worse than a blank cell, because it survives review — nobody re-reads the clause that already has a citation.

So Open Counsel doesn't ask for citations. It verifies them:

```
answer + quote + page  →  is that quote really in the text?
                             ├── yes → stored as an answer
                             └── no  → stored as unresolved, and the reviewer is told why
```

The check is mechanical — a normalised substring match against the extracted text of that document — so it holds no matter which model, prompt or version produced the answer. It tolerates the things that legitimately differ (smart quotes, line breaks, hyphenation, a clause running across a page break) and nothing that changes meaning.

## Features

- **Matters** — a workspace per deal, case or client, holding its documents and reviews.
- **Documents** — PDF, DOCX and plain text. Text is extracted on upload, page by page, and that text is what citations are checked against.
- **Tabular review** — a grid of documents × questions. Each cell is an answer, the page, and the verbatim quote it came from, one click away.
- **Three honest cell states** — *answered* (verified), *not addressed* (the document genuinely doesn't say), *unresolved* (evidence failed the check). The third never looks like the first.
- **Workflows** — save the columns of a review that worked; the next matter starts from it in one click.
- **CSV export** — the page and quote travel with every answer, so the evidence doesn't get lost when the grid leaves the app.

## How it works

| | |
|---|---|
| **The app** | stores documents, extracts their text, holds the grid, and verifies every citation |
| **Your agent** | reads the documents and answers the questions |

The app has no model provider keys and no chat window, on purpose — your Clawnify agent already is the reader, reachable from the dashboard, WhatsApp or email. Press **Run review** and the review is handed to it; if it can't be reached, you get the brief to paste into chat instead.

## Local development

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm dev          # UI on :5173, API on :8789
```

```bash
pnpm test         # verification rules
pnpm typecheck
pnpm build
```

Off-platform there is no agent to dispatch to — **Run review** hands you the brief to copy instead, and everything else works normally.

## Deploy

Deploy it to your own Clawnify organisation:

```bash
npx clawnify deploy
```

Or use the button in the [Clawnify app directory](https://app.clawnify.com). Each deployment gets its own database and file storage — the documents stay inside your own organisation.

## Extending it

- **New question types** — `review_columns.type` already carries `text | enum | date | money | boolean`; the grid renders them as text today.
- **Case law** — citation verification against a case-law source (e.g. CourtListener) is the natural next column type, and slots in beside the quote check rather than replacing it.
- **The verification rule** lives in one file, `src/server/citations.ts`, with its tests beside it. That is the file to read first, and the one to be careful with.

## Licence

MIT. See [LICENSE](LICENSE).

This project is an independent implementation and is not affiliated with, derived from, or endorsed by any other legal-AI product.
