import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, FileText, Plus, Trash2, Upload } from "lucide-react";
import { api, type Document, type Matter, type ReviewSummary, type Workflow } from "../api";
import { Badge, Button, Chip, Empty, Field, Input, Modal, Toolbar } from "../components/ui";

export default function MatterPage() {
  const { id = "" } = useParams();
  const [matter, setMatter] = useState<Matter | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const [m, d, r, w] = await Promise.all([
      api.matter(id),
      api.documents(id, "limit=100"),
      api.reviews(id),
      api.workflows(),
    ]);
    setMatter(m);
    setDocuments(d.documents);
    setReviews(r.reviews);
    setWorkflows(w.workflows);
  }

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [id]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setUploading(files.length);
    // Sequential rather than parallel: extraction runs inside the request, and
    // ten concurrent PDF parses in one isolate is how you find its memory limit.
    for (const file of Array.from(files)) {
      try {
        await api.upload(id, file);
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
      }
      setUploading((n) => n - 1);
    }
    await load();
  }

  const ready = documents.filter((d) => d.extract_status === "ready").length;
  const failed = documents.filter((d) => d.extract_status === "failed");

  return (
    <>
      <Toolbar title={matter?.name ?? "Matter"} subtitle={matter?.client || undefined}>
        <Button onClick={() => fileInput.current?.click()}>
          <Upload className="size-4" />
          Upload
        </Button>
        <Button variant="primary" onClick={() => setStarting(true)} disabled={ready === 0}>
          <Plus className="size-4" />
          New review
        </Button>
      </Toolbar>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,application/pdf"
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />

      {/* No max-width: list pages run full width, like the matters table. */}
      <div className="space-y-6 p-6">
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="eyebrow">Documents · {documents.length}</span>
            <span className="data text-[0.6875rem] text-faint">{ready} readable</span>
          </div>
          {documents.length === 0 ? (
            <Empty
              title="No documents yet."
              hint="Upload the PDFs or Word files you want reviewed. Text is extracted on upload so citations can be checked against it."
              action={
                <Button variant="primary" onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" />
                  Upload documents
                </Button>
              }
            />
          ) : (
            <div className="-mx-6 divide-y divide-border border-y border-border">
              {documents.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-6 py-2.5">
                  <FileText className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{d.name}</span>
                  {d.extract_status === "ready" ? (
                    <Chip>
                      {d.page_count} {d.locator_kind === "page" ? "pages" : "blocks"}
                    </Chip>
                  ) : null}
                  {d.extract_status === "failed" ? (
                    <Badge tone="danger">
                      <AlertTriangle className="size-3" />
                      unreadable
                    </Badge>
                  ) : null}
                  {d.extract_status === "pending" ? <Badge tone="warning">extracting</Badge> : null}
                  <Button
                    variant="ghost"
                    title={`Delete ${d.name}`}
                    onClick={async () => {
                      await api.deleteDocument(d.id);
                      await load();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {uploading > 0 ? (
            <p className="mt-3 text-xs text-muted">Uploading and extracting… {uploading} left</p>
          ) : null}
          {failed.length > 0 ? (
            <div className="mt-4">
              <span className="eyebrow">Could not be read</span>
              <ul className="mt-2 space-y-1">
                {failed.map((d) => (
                  <li key={d.id} className="text-xs text-muted">
                    <span className="text-foreground">{d.name}</span> — {d.extract_error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section>
          <div className="mb-3">
            <span className="eyebrow">Reviews · {reviews.length}</span>
          </div>
          {reviews.length === 0 ? (
            <Empty
              title="No reviews on this matter."
              hint={
                ready === 0
                  ? "Upload at least one readable document first."
                  : "A review is a set of questions asked of every document at once."
              }
            />
          ) : (
            <div className="-mx-6 divide-y divide-border border-y border-border">
              {reviews.map((r) => (
                <Link key={r.id} to={`/reviews/${r.id}`} className="flex items-center gap-3 px-6 py-2.5 hover:bg-sunken">
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{r.name}</span>
                  <Chip>{r.column_count} columns</Chip>
                  <span className="data text-[0.8125rem] text-muted">{r.answered} answered</span>
                  {r.rejected > 0 ? <Badge tone="danger">{r.rejected} unresolved</Badge> : null}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <NewReviewModal
        open={starting}
        onClose={() => setStarting(false)}
        matterId={id}
        workflows={workflows}
        onCreated={load}
      />
    </>
  );
}

/**
 * Two ways in, because they serve two people: a partner writes the questions
 * once, a junior picks the saved set. Both land in the same review.
 */
function NewReviewModal({
  open,
  onClose,
  matterId,
  workflows,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  matterId: string;
  workflows: Workflow[];
  onCreated: () => Promise<void>;
}) {
  const [questions, setQuestions] = useState("");
  const [error, setError] = useState("");

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const workflowId = String(data.get("workflow") ?? "");
    const name = String(data.get("name") ?? "");

    // One question per line is the fastest thing to type and the easiest to
    // paste out of an email — the keys are derived, never asked for.
    // Two similarly-worded questions can slugify to the same key, which the
    // server rejects as a duplicate column — suffix them rather than letting
    // the user discover it as a 500.
    const seen = new Map<string, number>();
    const columns = questions
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean)
      .map((question) => {
        const base = slugify(question);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return { key: n === 1 ? base : `${base}_${n}`, question };
      });

    try {
      const { id } = await api.createReview(matterId, {
        name,
        ...(workflowId ? { workflow_id: workflowId } : { columns }),
      });
      onClose();
      await onCreated();
      window.location.assign(`/reviews/${id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New review">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget);
        }}
      >
        <div className="space-y-3 p-5">
          <Field label="Review name">
            <Input name="name" required placeholder="e.g. NDA review — round 1" />
          </Field>
          {workflows.length > 0 ? (
            <Field label="Start from a workflow" hint="Or leave blank and write the questions below.">
              <select
                name="workflow"
                className="h-9 w-full rounded-sm border border-border bg-surface px-2 text-[0.8125rem] focus:border-ring focus:outline-none"
              >
                <option value="">— write my own questions —</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.columns.length} columns)
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Questions" hint="One per line. Each becomes a column asked of every document.">
            <textarea
              rows={5}
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              placeholder={"Is the NDA mutual or unilateral?\nWhat is the governing law?\nHow long do confidentiality obligations survive?"}
              className="w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-[0.8125rem] placeholder:text-faint focus:border-ring focus:outline-none"
            />
          </Field>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Create review
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A question becomes a stable column key the agent can write against. */
function slugify(question: string): string {
  return (
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .split("_")
      .slice(0, 5)
      .join("_") || "column"
  );
}
