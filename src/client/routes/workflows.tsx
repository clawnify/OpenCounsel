import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, type Workflow } from "../api";
import { Button, Card, Chip, Empty, Eyebrow, Toolbar, Zone } from "../components/ui";

export default function Workflows() {
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const { workflows } = await api.workflows();
    setWorkflows(workflows);
  }

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, []);

  return (
    <>
      <Toolbar title="Workflows" subtitle="Column sets your team reuses across matters" />

      <div className="mx-auto max-w-[75rem] space-y-4 p-6">
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {workflows && workflows.length === 0 ? (
          <Empty
            title="No saved workflows yet."
            hint="Open a review that worked and choose “Save as workflow” — its columns become a one-click starting point for the next matter."
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
                <ol className="mt-2 space-y-1.5">
                  {w.columns.map((col) => (
                    <li key={col.key} className="flex items-start gap-2 text-[0.8125rem]">
                      <Chip>{col.key}</Chip>
                      <span className="min-w-0 flex-1">{col.question}</span>
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
