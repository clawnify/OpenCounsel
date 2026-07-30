// Handing a review to the org's agent.
//
// The split this app is built on: it owns the *record* — documents, extracted
// text, the grid, and above all the verification of every citation. It does not
// own the *reading*, which needs judgment over long legal prose and minutes of
// runtime. That work goes to the org's agent through the platform's
// `/v1/agents` route, which pushes one instruction into the agent and returns.
//
// There is nothing to poll. Delivery is one-way by design: the agent reports
// back through this app's own API (`POST /api/reviews/{id}/cells`), which is
// why the cells table — not the platform — is the record of progress.

/** Platform route that delivers a task to the org's agent. */
const DEFAULT_AGENTS_URL = "https://provision.clawnify.com/v1/agents";

export interface AgentEnv {
  /** Minted per org by the platform. Absent off-platform (`pnpm dev`). */
  CLAWNIFY_TOKEN?: string;
  /** Override for local testing against a dev API. */
  CLAWNIFY_AGENTS_URL?: string;
}

export interface AgentServer {
  id: string;
  name: string | null;
  status: string | null;
}

/**
 * Dispatch outcome as a value rather than an exception, so a caller cannot
 * forget the failure path — every failure here has a user-facing fallback
 * (show the brief so it can be pasted into chat), not a stack trace.
 */
export type DispatchResult =
  | { ok: true; taskId: string; serverId: string | null; duplicate: boolean }
  | { ok: false; error: string; servers?: AgentServer[] };

function base(env: AgentEnv): string {
  return (env.CLAWNIFY_AGENTS_URL ?? DEFAULT_AGENTS_URL).replace(/\/+$/, "");
}

/**
 * Whether this deployment can reach the platform at all. False off-platform,
 * where the app still works — the user hands the brief over by hand instead.
 */
export function dispatchAvailable(env: AgentEnv): boolean {
  return Boolean(env.CLAWNIFY_TOKEN);
}

async function call(
  env: AgentEnv,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base(env)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CLAWNIFY_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    // The platform forwards to a VPS with its own 15s timeout; this bounds the
    // whole hop so a wedged box can't hold a user-facing request open.
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { error: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

/**
 * Agent servers this org can hand work to. Null — not an empty array — when the
 * app cannot reach the platform, so "no agents" and "can't tell" stay distinct.
 */
export async function listAgentServers(env: AgentEnv): Promise<AgentServer[] | null> {
  if (!dispatchAvailable(env)) return null;
  try {
    const { status, body } = await call(env, "/servers");
    if (status !== 200) return null;
    return (body.servers as AgentServer[]) ?? [];
  } catch {
    return null;
  }
}

export async function dispatchTask(
  env: AgentEnv,
  opts: { instruction: string; serverId?: string | null; idempotencyKey: string },
): Promise<DispatchResult> {
  if (!dispatchAvailable(env)) {
    return { ok: false, error: "This app can't reach your agent — hand the brief over in chat instead." };
  }

  let status: number;
  let body: Record<string, unknown>;
  try {
    ({ status, body } = await call(env, "/tasks", {
      method: "POST",
      body: JSON.stringify({
        instruction: opts.instruction,
        ...(opts.serverId ? { server_id: opts.serverId } : {}),
        idempotency_key: opts.idempotencyKey,
      }),
    }));
  } catch (err) {
    return { ok: false, error: `Could not reach your agent: ${(err as Error).message}` };
  }

  // 202 = dispatched, 200 = the platform recognised this as a retry of a task it
  // already delivered. Both mean the agent has the work; only one sent it.
  if (status === 202 || status === 200) {
    return {
      ok: true,
      taskId: String(body.task_id ?? ""),
      serverId: (body.server_id as string | null) ?? null,
      duplicate: body.status === "duplicate",
    };
  }

  // The org runs more than one agent and none was chosen. The platform refuses
  // rather than guessing, and hands back the list — pass it through so the user
  // can choose without a second round-trip.
  if (body.error === "multiple_servers") {
    return {
      ok: false,
      error: "You have more than one agent — choose which one runs reviews in Settings.",
      servers: (body.servers as AgentServer[]) ?? [],
    };
  }

  const detail = typeof body.detail === "string" ? ` (${body.detail})` : "";
  return { ok: false, error: `${body.error ?? `Agent dispatch failed (${status})`}${detail}` };
}

/**
 * The review instruction — one text with two audiences: it is what the platform
 * delivers to the agent, and what the user copies into chat when dispatch is
 * unavailable. Kept in one place so those can never drift.
 *
 * It deliberately states the rejection rule up front. An agent that learns the
 * rule only by being rejected wastes a round trip per cell; one that is told
 * "the quote is checked" writes verifiable answers from the first attempt.
 */
export function reviewBrief(opts: {
  reviewId: string;
  reviewName: string;
  appUrl: string;
  documentCount: number;
  questions: { key: string; question: string; hint?: string; type?: string; options?: string }[];
}): string {
  // The hint carries the real instruction — imported column sets put several
  // sentences of "what to look for" there and only a short label in `question`,
  // so a brief built from the label alone would throw away the column's whole
  // substance and ask the agent a two-word question.
  const questionList = opts.questions
    .map((q) => {
      const lines = [`  - ${q.key} — ${q.question}`];
      if (q.hint) lines.push(`      ${q.hint}`);
      if (q.type && q.type !== "text") {
        const shape =
          q.type === "bulleted_list"
            ? "answer as a short bulleted list"
            : q.type === "enum" && q.options
              ? `answer with one of: ${q.options}`
              : `answer as a ${q.type.replace("_", " ")}`;
        lines.push(`      (${shape})`);
      }
      return lines.join("\n");
    })
    .join("\n");
  return [
    `Run the "${opts.reviewName}" review in Open Counsel (${opts.appUrl}).`,
    ``,
    `There are ${opts.documentCount} document(s) in this review. For each one,`,
    `answer every column below:`,
    ``,
    questionList,
    ``,
    `Read each document's text with GET /api/documents/{id}/pages (paginated —`,
    `read every page, not just the first). Then POST your answers to`,
    `/api/reviews/${opts.reviewId}/cells.`,
    ``,
    `Every answer must carry a quote copied verbatim from the document and the`,
    `page it appears on. The app checks that the quote is really in the text and`,
    `REJECTS it if not — a rejected cell is shown to the user as unresolved, so`,
    `an invented quote costs you the answer. If a document genuinely does not`,
    `address a column, send {"status":"not_found"} for it rather than guessing.`,
    ``,
    `Work document by document and post as you go, so progress is visible.`,
  ].join("\n");
}
