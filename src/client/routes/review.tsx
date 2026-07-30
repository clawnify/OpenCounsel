import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bookmark, Download, Play, Quote, TriangleAlert } from "lucide-react";
import { api, type Cell, type Document, type Review } from "../api";
import { Badge, Button, Card, Chip, Empty, Eyebrow, Field, Input, Modal, Toolbar, Zone } from "../components/ui";

export default function ReviewGrid() {
  const { id = "" } = useParams();
  const [review, setReview] = useState<Review | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [open, setOpen] = useState<{ cell: Cell; document: Document; question: string } | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const r = await api.review(id);
    setReview(r);
    const [docs, cellPage] = await Promise.all([
      api.documents(r.matter_id, "limit=100"),
      api.cells(id, "limit=100"),
    ]);
    setDocuments(docs.documents.filter((d) => d.extract_status === "ready"));

    // The grid is documents × columns, so one page of cells is rarely the whole
    // grid. Walk the pages rather than showing a silently truncated review.
    let all = cellPage.cells;
    for (let page = 2; all.length < cellPage.total; page++) {
      const next = await api.cells(id, `limit=100&page=${page}`);
      if (!next.cells.length) break;
      all = all.concat(next.cells);
    }
    setCells(all);
  }

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [id]);

  async function run() {
    setError("");
    try {
      const result = await api.runReview(id);
      if (result.dispatched) {
        await load();
        setError("");
      } else {
        // Dispatch is unavailable (running off-platform, or the org has more
        // than one agent). The brief is still the deliverable — show it so the
        // user can paste it into chat instead of hitting a dead end.
        setBrief(result.brief);
        if (result.error) setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * A review is named for an occasion ("NDA review — round 1"); a workflow is
   * named for a document type ("NDA review"), because it is going to be picked
   * from a list months later. Strip the occasion to suggest a reusable name,
   * then let the user correct it — saving silently under the review's own name
   * produces a library nobody can navigate.
   */
  function suggestedWorkflowName(reviewName: string): string {
    return reviewName.replace(/\s*[—-]\s*(round|pass|v)\s*\d+\s*$/i, "").trim() || reviewName;
  }

  async function saveAsWorkflow(name: string) {
    await api.createWorkflow({
      name,
      from_review_id: id,
      description: `${review?.columns.length ?? 0} columns, saved from a review that worked.`,
    });
    setSaving(false);
    setSaved(name);
  }

  const byKey = new Map(cells.map((c) => [`${c.document_id}:${c.column_id}`, c]));
  const columns = review?.columns ?? [];
  const total = documents.length * columns.length;

  return (
    <>
      <Toolbar
        title={review?.name ?? "Review"}
        subtitle={
          review
            ? `${review.answered} answered · ${review.not_found} not addressed · ${review.rejected} unresolved of ${total}`
            : undefined
        }
      >
        <Button
          onClick={() => setSaving(true)}
          title="Reuse this review's questions on the next matter"
        >
          <Bookmark className="size-4" />
          Save as workflow
        </Button>
        <a href={`/api/reviews/${id}/export.csv`} download>
          <Button>
            <Download className="size-4" />
            CSV
          </Button>
        </a>
        <Button variant="primary" onClick={run}>
          <Play className="size-4" />
          Run review
        </Button>
      </Toolbar>

      <div className="p-6">
        <Link
          to={review ? `/matters/${review.matter_id}` : "/matters"}
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to matter
        </Link>

        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {review && review.rejected > 0 ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-tint p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="text-[0.8125rem] text-danger">
              <strong className="font-semibold">{review.rejected} unresolved</strong> — an answer was offered but its
              quote could not be found in the document, so it is not shown as an answer. Run the review again to retry
              those cells.
            </div>
          </div>
        ) : null}

        {documents.length === 0 || columns.length === 0 ? (
          <Empty
            title="Nothing to review yet."
            hint="A review needs at least one readable document and one column."
          />
        ) : (
          <Card className="overflow-hidden">
            <Zone>
              <Eyebrow right={`${documents.length} × ${columns.length}`}>Review grid</Eyebrow>
            </Zone>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-sunken text-left">
                    <th className="sticky left-0 z-[1] min-w-56 bg-sunken px-3 py-2.5 text-xs font-semibold tracking-[0.04em] text-muted">
                      Document
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.id}
                        className="min-w-56 border-l border-border px-3 py-2.5 text-xs font-semibold tracking-[0.04em] text-muted"
                        title={col.question}
                      >
                        {col.question}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-t border-border">
                      <td className="sticky left-0 z-[1] bg-surface px-3 py-2 text-[0.8125rem]">
                        <span className="line-clamp-2">{doc.name}</span>
                      </td>
                      {columns.map((col) => {
                        const cell = byKey.get(`${doc.id}:${col.id}`);
                        return (
                          <td key={col.id} className="border-l border-border px-3 py-2 align-top">
                            <CellView
                              cell={cell}
                              type={col.type}
                              onOpen={() => cell && setOpen({ cell, document: doc, question: col.question })}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <CitationModal open={open} onClose={() => setOpen(null)} />

      <Modal open={saving} onClose={() => setSaving(false)} title="Save as workflow">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (name) void saveAsWorkflow(name);
          }}
        >
          <div className="space-y-3 p-5">
            <p className="text-xs text-muted">
              Saves this review's {columns.length} questions — not its answers — so the next matter can start from
              them in one click.
            </p>
            <Field label="Workflow name" hint="Name it for the document type, not this matter.">
              <Input name="name" required defaultValue={suggestedWorkflowName(review?.name ?? "")} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setSaving(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save workflow
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={saved !== null} onClose={() => setSaved(null)} title="Saved">
        <div className="p-5 text-[0.8125rem]">
          <p>
            <strong className="font-semibold">{saved}</strong> is now in your workflows. Starting a review on any
            matter can begin from it.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={() => setSaved(null)}>Close</Button>
          <Link to="/workflows">
            <Button variant="primary">View workflows</Button>
          </Link>
        </div>
      </Modal>

      <Modal open={brief !== null} onClose={() => setBrief(null)} title="Hand this to your agent">
        <div className="p-5">
          <p className="mb-2 text-xs text-muted">
            This app could not reach an agent directly. Paste the brief below into your agent's chat.
          </p>
          <pre className="max-h-80 overflow-auto rounded-sm border border-border bg-sunken p-3 text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
            {brief}
          </pre>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={() => setBrief(null)}>Close</Button>
          <Button
            variant="primary"
            onClick={() => {
              void navigator.clipboard.writeText(brief ?? "");
              setBrief(null);
            }}
          >
            Copy brief
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * One cell. The three states are visually distinct on purpose: a verified
 * answer, an honest "the document doesn't say", and a claim whose evidence
 * failed the check. The third must never look like the first.
 */
/**
 * Ten muted pairs from the design system. A categorical *data* value always
 * hashes to the same colour, so "Mutual" reads the same in every row and the
 * eye can scan a column without reading it. This is the one place chroma is
 * welcome — it is data, not chrome.
 */
const PILL_COLORS = [
  ["#FEF2F2", "#DC2626"], ["#ECFDF5", "#059669"], ["#EFF6FF", "#2563EB"],
  ["#FFFBEB", "#D97706"], ["#F5F3FF", "#7C3AED"], ["#F0FDFA", "#0D9488"],
  ["#FDF2F8", "#DB2777"], ["#FFF7ED", "#EA580C"], ["#FAF5FF", "#9333EA"],
  ["#F0FDF4", "#16A34A"],
] as const;

function pillColor(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return PILL_COLORS[Math.abs(hash) % PILL_COLORS.length];
}

/**
 * Short, enumerable answers ("Mutual", "New York") read as categories and get a
 * pill; a sentence does not. The imported column sets declare most of these as
 * plain text rather than an enum, so this is decided by the shape of the answer
 * rather than by the column's type.
 */
function isCategorical(value: string, type?: string): boolean {
  if (type === "enum" || type === "boolean") return true;
  if (type && type !== "text") return false;
  return value.length <= 24 && !/[.;:]/.test(value) && value.split(/\s+/).length <= 3;
}

function CellView({ cell, type, onOpen }: { cell?: Cell; type?: string; onOpen: () => void }) {
  if (!cell) return <span className="text-xs text-faint">—</span>;

  if (cell.status === "not_found") {
    return <span className="text-xs text-muted italic">not addressed</span>;
  }

  if (cell.status === "rejected") {
    return (
      <button onClick={onOpen} className="group text-left" aria-label="Show why this answer was rejected">
        <Badge tone="danger">
          <TriangleAlert className="size-3" />
          unresolved
        </Badge>
        <span className="mt-1 block text-[0.6875rem] text-muted line-clamp-2">{cell.rejected_reason}</span>
      </button>
    );
  }

  return (
    <button onClick={onOpen} className="w-full text-left" aria-label="Show the citation for this answer">
      <AnswerValue value={cell.value} type={type} />
      <span className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] text-link group-hover:underline">
        <Quote className="size-3" />
        p.{cell.page_no}
      </span>
    </button>
  );
}

function AnswerValue({ value, type }: { value: string; type?: string }) {
  if (!value) return <span className="block text-[0.8125rem] text-faint">—</span>;

  if (type === "bulleted_list") {
    // Imported packs ask for lists on 9 of 11 column sets; agents write them as
    // newline- or dash-separated text, so render whichever arrives.
    const items = value
      .split(/\n+|(?:^|\s)[-•]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length > 1) {
      return (
        <ul className="list-disc space-y-0.5 pl-4 text-[0.8125rem] text-foreground">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    }
  }

  if (isCategorical(value, type)) {
    const [bg, fg] = pillColor(value.toLowerCase());
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal"
        style={{ backgroundColor: bg, color: fg }}
      >
        {value}
      </span>
    );
  }

  return <span className="block text-[0.8125rem] text-foreground">{value}</span>;
}

/** The evidence behind one cell — the reason to trust the grid at all. */
function CitationModal({
  open,
  onClose,
}: {
  open: { cell: Cell; document: Document; question: string } | null;
  onClose: () => void;
}) {
  if (!open) return null;
  const { cell, document: doc, question } = open;

  return (
    <Modal open onClose={onClose} title={question}>
      <div className="space-y-4 p-5">
        <div>
          <Eyebrow>Answer</Eyebrow>
          <p className="mt-1 text-[0.8125rem]">
            {cell.status === "rejected" ? <span className="text-muted italic">not shown — evidence failed</span> : cell.value}
          </p>
        </div>

        <div>
          <Eyebrow right={cell.page_no ? `page ${cell.page_no}` : undefined}>Cited passage</Eyebrow>
          <blockquote className="mt-1 border-l-2 border-border pl-3 text-[0.8125rem] text-muted">
            {cell.quote || "— none given —"}
          </blockquote>
        </div>

        {cell.status === "rejected" ? (
          <div className="rounded-sm border border-danger/25 bg-danger-tint p-3">
            <Eyebrow>Why it was rejected</Eyebrow>
            <p className="mt-1 text-[0.8125rem] text-danger">{cell.rejected_reason}</p>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Chip>{doc.name}</Chip>
          {cell.status === "answered" ? <Badge tone="success">quote verified in source</Badge> : null}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button onClick={onClose}>Close</Button>
        <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer">
          <Button variant="primary">Open document</Button>
        </a>
      </div>
    </Modal>
  );
}
