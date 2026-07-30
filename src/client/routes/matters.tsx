import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, type Matter } from "../api";
import { Button, Empty, Field, Input, Modal, Toolbar } from "../components/ui";

export default function Matters() {
  const [matters, setMatters] = useState<Matter[] | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load(q = search) {
    try {
      const { matters } = await api.matters(`limit=50${q ? `&search=${encodeURIComponent(q)}` : ""}`);
      setMatters(matters);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load("");
  }, []);

  async function create(form: HTMLFormElement) {
    const data = new FormData(form);
    await api.createMatter({
      name: String(data.get("name") ?? ""),
      client: String(data.get("client") ?? ""),
    });
    setCreating(false);
    await load();
  }

  const open = matters?.filter((m) => m.status === "open").length ?? 0;

  return (
    <>
      <Toolbar title="Matters" subtitle="Every review starts with a matter">
        <Input
          type="search"
          placeholder="Search matters…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            void load(e.target.value);
          }}
          className="hidden w-56 sm:block"
        />
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New matter
        </Button>
      </Toolbar>

      {/* Full width, no max-width cap: a table page is the table. */}
      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {matters && matters.length === 0 ? (
          <Empty
            title="No matters yet."
            hint="A matter holds the documents for one deal, case or client — open one to start."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New matter
              </Button>
            }
          />
        ) : (
          // Full-bleed: the header row and the row hairlines are the table's
          // frame. A card border around it would draw a second, redundant one.
          <>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="eyebrow">Matters · {matters?.length ?? 0}</span>
              <span className="data text-[0.6875rem] text-faint">{open} open</span>
            </div>
            {/* -mx-6 cancels the page padding so the header fill and the row
                hairlines reach both edges; first:pl-6 / last:pr-6 puts the text
                back in line with the page furniture above it. */}
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full [&_td]:first:pl-6 [&_th]:first:pl-6">
                <thead>
                  <tr className="border-y border-border bg-sunken text-left">
                    <th className="px-3 py-2.5 first:pl-6 last:pr-6 text-xs font-semibold tracking-[0.04em] text-muted">Matter</th>
                    <th className="px-3 py-2.5 first:pl-6 last:pr-6 text-xs font-semibold tracking-[0.04em] text-muted">Client</th>
                    <th className="px-3 py-2.5 first:pl-6 last:pr-6 text-right text-xs font-semibold tracking-[0.04em] text-muted">Documents</th>
                    <th className="px-3 py-2.5 first:pl-6 last:pr-6 text-right text-xs font-semibold tracking-[0.04em] text-muted">Reviews</th>
                  </tr>
                </thead>
                <tbody>
                  {(matters ?? []).map((m) => (
                    <tr key={m.id} className="border-t border-border hover:bg-sunken">
                      <td className="px-3 py-2.5 first:pl-6 last:pr-6">
                        <Link to={`/matters/${m.id}`} className="link">
                          {m.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 first:pl-6 last:pr-6 text-[0.8125rem] text-muted">{m.client || "—"}</td>
                      <td className="data px-3 py-2.5 first:pl-6 last:pr-6 text-right text-[0.8125rem]">{m.document_count ?? 0}</td>
                      <td className="data px-3 py-2.5 first:pl-6 last:pr-6 text-right text-[0.8125rem]">{m.review_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-sunken">
                    <td className="px-3 py-2 first:pl-6 text-xs text-muted" colSpan={2}>
                      Total
                    </td>
                    <td className="data px-3 py-2 last:pr-6 text-right text-xs text-muted">
                      {(matters ?? []).reduce((n, m) => n + (m.document_count ?? 0), 0)}
                    </td>
                    <td className="data px-3 py-2 last:pr-6 text-right text-xs text-muted">
                      {(matters ?? []).reduce((n, m) => n + (m.review_count ?? 0), 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New matter">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(e.currentTarget);
          }}
        >
          <div className="space-y-3 p-5">
            <Field label="Matter name">
              <Input name="name" required placeholder="e.g. Project Aurora — NDAs" />
            </Field>
            <Field label="Client">
              <Input name="client" placeholder="e.g. Northstar Biotech" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Open matter
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
