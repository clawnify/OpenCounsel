import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { api, type Pack, type Workflow } from "../api";
import { Badge, Button, Card, Chip, Empty, Eyebrow, Toolbar, Zone } from "../components/ui";

export default function Workflows() {
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [w, p] = await Promise.all([api.workflows(), api.packs()]);
    setWorkflows(w.workflows);
    setPacks(p.packs);
  }

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, []);

  async function importPack(id: string) {
    setBusy(id);
    try {
      await api.importPack(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const imported = new Set((workflows ?? []).map((w) => w.source_pack).filter(Boolean));

  return (
    <>
      <Toolbar title="Workflows" subtitle="Column sets your team reuses across matters" />

      <div className="space-y-6 p-6">
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <section>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="eyebrow">Library</span>
            <span className="data text-[0.6875rem] text-faint">{packs.length} available</span>
          </div>
          <p className="mb-3 max-w-3xl text-xs text-muted">
              Practitioner-authored review criteria, published under the MIT licence by{" "}
              <a className="link" href="https://github.com/Open-Legal-Products/mike-workflows">
                Open Legal Products
              </a>
              . Importing copies a set into your workflows, where it is yours to edit.
          </p>
          <div className="-mx-6 divide-y divide-border border-y border-border">
            {packs.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-6 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[0.8125rem]">{p.name}</span>
                    <Chip>{p.column_count} columns</Chip>
                    {p.jurisdictions && p.jurisdictions !== "General" ? <Chip>{p.jurisdictions}</Chip> : null}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[0.6875rem] text-faint">{p.practice}</p>
                </div>
                {imported.has(p.id) ? (
                  <Badge tone="success">imported</Badge>
                ) : (
                  <Button onClick={() => void importPack(p.id)} disabled={busy === p.id}>
                    <Download className="size-4" />
                    {busy === p.id ? "Importing…" : "Import"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        {workflows && workflows.length === 0 ? (
          <Empty
            title="No workflows of your own yet."
            hint="Import one from the library above, or open a review that worked and choose “Save as workflow”."
          />
        ) : (
          (workflows ?? []).map((w) => (
            <Card key={w.id}>
              <Zone>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Eyebrow>Workflow</Eyebrow>
                    <h2 className="mt-1 text-base font-semibold">{w.name}</h2>
                    {w.description ? <p className="text-xs text-muted">{w.description}</p> : null}
                    {w.source_url ? (
                      <p className="mt-1 text-[0.6875rem] text-faint">
                        {w.author} ·{" "}
                        <a className="link" href={w.source_url}>
                          {w.license}
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    title={`Delete ${w.name}`}
                    onClick={async () => {
                      await api.deleteWorkflow(w.id);
                      await load();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Zone>
              <Zone>
                <Eyebrow right={`${w.columns.length} columns`}>Questions</Eyebrow>
                <ol className="mt-2 space-y-2">
                  {w.columns.map((col) => (
                    <li key={col.key} className="text-[0.8125rem]">
                      <div className="flex items-start gap-2">
                        <Chip>{col.type && col.type !== "text" ? col.type.replace("_", " ") : col.key}</Chip>
                        <span className="min-w-0 flex-1 font-medium">{col.question}</span>
                      </div>
                      {col.hint ? <p className="mt-0.5 pl-1 text-[0.6875rem] text-muted line-clamp-2">{col.hint}</p> : null}
                    </li>
                  ))}
                </ol>
              </Zone>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
