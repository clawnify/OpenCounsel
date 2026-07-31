// The redline screen.
//
// What a lawyer does here is *approve*, not author: the anchors and the wording
// come from the agent, and the decision — this change yes, that one no — is the
// human's. So every edit shows what it replaces, what with, and why, and the
// only controls are keep, drop, and build.
//
// A rejected edit stays on screen with its reason rather than being hidden. The
// reason is always the same shape of mistake (an anchor that names two clauses,
// or none), and seeing it is how someone learns to ask for something narrower.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { api, type Document, type Revision, type RevisionEdit } from "../api";
import { Badge, Button, Chip, Empty, Field, Modal, Textarea, Toolbar } from "../components/ui";

interface Loaded {
  revision: Revision;
  edits: RevisionEdit[];
}

export default function RedlinePage() {
  const { id = "" } = useParams();
  const [document, setDocument] = useState<Document | null>(null);
  const [rounds, setRounds] = useState<Loaded[]>([]);
  const [building, setBuilding] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [doc, list] = await Promise.all([api.document(id), api.revisions(id)]);
    setDocument(doc);
    // Each round is fetched with its edits: a document carries a handful of
    // negotiating rounds, not a feed, so there is nothing to paginate and
    // collapsing them behind a click would hide the only thing worth reading.
    setRounds(await Promise.all(list.revisions.map((r) => api.revision(r.id))));
  }

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [id]);

  async function build(revisionId: string) {
    setBuilding(revisionId);
    setError("");
    try {
      const result = await api.buildRedline(revisionId);
      if (result.error) setError(result.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuilding("");
      await load();
    }
  }

  return (
    <>
      <Toolbar title={document?.name ?? "Redline"} subtitle="Proposed changes">
        {document ? (
          <Link
            to={`/matters/${document.matter_id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm text-muted hover:bg-sunken hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Matter
          </Link>
        ) : null}
        <Button variant="primary" onClick={() => setAsking(true)}>
          <Sparkles className="size-4" />
          Propose changes
        </Button>
      </Toolbar>

      <div className="space-y-8 p-6">
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {rounds.length === 0 ? (
          <Empty
            title="No changes proposed yet."
            hint="Say what you want changed and the agent reads the document and proposes the edits. You approve them, then build a Word file with tracked changes."
            action={
              <Button variant="primary" onClick={() => setAsking(true)}>
                <Sparkles className="size-4" />
                Propose changes
              </Button>
            }
          />
        ) : (
          rounds.map(({ revision, edits }) => (
            <Round
              key={revision.id}
              revision={revision}
              edits={edits}
              building={building === revision.id}
              onBuild={() => void build(revision.id)}
              onToggle={async (editId, include) => {
                await api.setEditIncluded(revision.id, editId, include);
                await load();
              }}
              onDelete={async () => {
                await api.deleteRevision(revision.id);
                await load();
              }}
            />
          ))
        )}
      </div>

      <ProposeModal open={asking} onClose={() => setAsking(false)} documentId={id} onDispatched={load} />
    </>
  );
}

function Round({
  revision,
  edits,
  building,
  onBuild,
  onToggle,
  onDelete,
}: {
  revision: Revision;
  edits: RevisionEdit[];
  building: boolean;
  onBuild: () => void;
  onToggle: (editId: string, include: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const keeping = edits.filter((e) => e.status !== "rejected" && e.status !== "excluded").length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="eyebrow">{revision.name || "Proposed changes"}</span>
          <p className="mt-0.5 text-[0.6875rem] text-faint">
            {edits.length} edit{edits.length === 1 ? "" : "s"} · {keeping} kept
            {revision.revisions_found != null ? ` · ${revision.revisions_found} tracked changes in the file` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {revision.status === "ready" ? (
            // A plain link, not fetch-then-blob: the browser already knows how
            // to save a file the server names, and this is the one artefact the
            // whole screen exists to produce.
            <a
              href={`/api/revisions/${revision.id}/download`}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-2 text-sm font-medium text-on-primary hover:bg-primary-hover"
            >
              <Download className="size-4" />
              Download .docx
            </a>
          ) : null}
          <Button onClick={onBuild} disabled={building || keeping === 0} variant={revision.status === "ready" ? "secondary" : "primary"}>
            {building ? <Loader2 className="size-4 animate-spin" /> : null}
            {building ? "Building…" : revision.status === "ready" ? "Rebuild" : "Build redline"}
          </Button>
          <Button variant="ghost" title="Delete this round" onClick={() => void onDelete()}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {revision.status === "failed" && revision.error ? (
        <p className="mb-3 text-xs text-danger">{revision.error}</p>
      ) : null}

      {/* Full-bleed, like every other list in the app: the hairlines reach both
          edges and the text realigns with the page padding. */}
      <div className="-mx-6 divide-y divide-border border-y border-border">
        {edits.map((edit) => (
          <Edit key={edit.id} edit={edit} onToggle={onToggle} />
        ))}
      </div>
    </section>
  );
}

const STATUS: Record<string, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  applied: { tone: "success", label: "in the redline" },
  proposed: { tone: "neutral", label: "will be applied" },
  excluded: { tone: "neutral", label: "dropped" },
  rejected: { tone: "danger", label: "unusable anchor" },
  unapplied: { tone: "danger", label: "could not be applied" },
};

function Edit({
  edit,
  onToggle,
}: {
  edit: RevisionEdit;
  onToggle: (editId: string, include: boolean) => Promise<void>;
}) {
  const status = STATUS[edit.status] ?? STATUS.proposed;
  const dropped = edit.status === "excluded";
  const broken = edit.status === "rejected" || edit.status === "unapplied";

  return (
    <div className={`px-6 py-3 ${dropped ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Struck-through original above the replacement, which is how a
              redline reads in Word — the same shape here as in the file. */}
          <p className="text-[0.8125rem] leading-relaxed text-muted line-through decoration-danger/50">{edit.anchor}</p>
          <p className="text-[0.8125rem] leading-relaxed">
            {edit.replacement || <span className="italic text-faint">(deleted)</span>}
          </p>
          {edit.reason ? <p className="text-xs text-muted">{edit.reason}</p> : null}
          {broken && edit.rejected_reason ? (
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {edit.rejected_reason}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {edit.page_no ? <Chip>p. {edit.page_no}</Chip> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
          {/* A rejected edit has nothing to toggle: its anchor names no single
              passage, so there is no version of it that could be applied. */}
          {edit.status !== "rejected" ? (
            <Button
              variant="ghost"
              title={dropped ? "Put this edit back" : "Drop this edit"}
              onClick={() => void onToggle(edit.id, dropped)}
            >
              {dropped ? <Check className="size-4" /> : <X className="size-4" />}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The instruction is prose, not a form. What a lawyer wants changed is a
 * position ("cap liability at 12 months' fees, make confidentiality mutual"),
 * and the agent is the thing that turns a position into anchored edits — asking
 * a human to write anchors would be asking them to do the machine's half.
 */
function ProposeModal({
  open,
  onClose,
  documentId,
  onDispatched,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  onDispatched: () => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [brief, setBrief] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setSending(true);
    setError("");
    try {
      const result = await api.proposeChanges(documentId, instruction);
      if (result.dispatched) {
        onClose();
        setInstruction("");
        await onDispatched();
      } else {
        // Degrade to something the user can act on rather than a dead end: the
        // brief is the same text the agent would have received, so it can be
        // pasted into chat.
        setError(result.error ?? "Could not reach your agent.");
        setBrief(result.brief);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Propose changes">
      <div className="space-y-3 p-5">
        <Field
          label="What should change?"
          hint="The agent reads the document and proposes anchored edits. You approve them before anything is written."
        >
          <Textarea
            rows={5}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={
              "Cap our liability at 12 months' fees.\nMake the confidentiality obligations mutual.\nRemove the automatic renewal."
            }
          />
        </Field>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {brief ? (
          <Field label="Send this to your agent instead">
            <Textarea rows={6} readOnly value={brief} className="font-mono text-[0.6875rem]" />
          </Field>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={sending || !instruction.trim()}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : null}
          {sending ? "Sending…" : "Ask the agent"}
        </Button>
      </div>
    </Modal>
  );
}
