import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { api } from "../api";
import { Card, Chip, Eyebrow, Toolbar, Zone } from "../components/ui";

interface AgentState {
  available: boolean;
  reachable: boolean;
  server_id: string | null;
  servers: { id: string; name: string | null; status: string | null }[];
}

/**
 * Which agent reads the documents.
 *
 * Only worth a choice when the org runs more than one: with a single agent the
 * platform resolves it, and with several it refuses to guess — so an unset
 * choice is what makes "Run review" fail with an error the user can't act on.
 */
export default function Settings() {
  const [state, setState] = useState<AgentState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setState(await api.agent());
  }

  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, []);

  async function choose(serverId: string) {
    setSaving(true);
    setError("");
    try {
      await api.setAgentServer(serverId || null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Toolbar title="Settings" subtitle="Configure once — every review uses this" />

      <div className="mx-auto max-w-[75rem] p-6">
        <Card>
          <Zone>
            <Eyebrow right={state?.available ? undefined : "unavailable"}>Reviewing agent</Eyebrow>
            <p className="mt-1 text-xs text-muted">
              Reviews are handed to your agent, which reads each document and posts answers back here. Every answer it
              sends is checked against the document before this app will show it.
            </p>

            {!state ? (
              <p className="mt-2 text-xs text-faint">Loading…</p>
            ) : !state.available ? (
              <p className="mt-2 text-xs text-warning">
                This deployment can't reach the platform, so “Run review” falls back to a brief you paste into your
                agent's chat.
              </p>
            ) : !state.reachable ? (
              <p className="mt-2 text-xs text-danger">Couldn't reach the platform to list your agents. Try again shortly.</p>
            ) : state.servers.length === 0 ? (
              <p className="mt-2 text-xs text-warning">No agents in this organization yet.</p>
            ) : state.servers.length === 1 ? (
              <div className="mt-2">
                <Chip>
                  <Bot className="size-3" /> {state.servers[0].name || state.servers[0].id}
                </Chip>
                <p className="mt-1 text-[0.6875rem] text-faint">
                  Your only agent — nothing to choose. Reviews go here.
                </p>
              </div>
            ) : (
              <div className="mt-2">
                <select
                  value={state.server_id ?? ""}
                  disabled={saving}
                  onChange={(e) => void choose(e.target.value)}
                  aria-label="Agent that runs reviews"
                  className="h-9 w-full max-w-sm rounded-sm border border-border bg-surface px-2 text-[0.8125rem] focus:border-ring focus:outline-none"
                >
                  <option value="">Choose an agent…</option>
                  {state.servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.id}
                      {s.status && s.status !== "ready" ? ` (${s.status})` : ""}
                    </option>
                  ))}
                </select>
                {!state.server_id ? (
                  <p className="mt-1 text-[0.6875rem] text-warning">
                    You have more than one agent. Pick the one that runs reviews — the platform won't choose for you, so
                    “Run review” can't start until this is set.
                  </p>
                ) : null}
              </div>
            )}

            {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
          </Zone>
        </Card>
      </div>
    </>
  );
}
