// Turning approved edits into a Word file with tracked changes.
//
// The comparison itself is a managed platform service, not something this app
// does. That is not a shortcut — the engine is Microsoft's own Open-XML
// comparer, ~32 MB of .NET, which could never live in a Worker bundle, and
// hand-authoring <w:ins>/<w:del> instead would mean owning run boundaries,
// numbering, styles and footnotes forever with a corrupted contract as the
// failure mode.
//
// What this app owns is the part that has to be right about *this* document:
// which edits were proposed, whether each one names a real and unambiguous
// passage, which ones the reviewer approved, and the file that came back.

/** Platform host for managed services. */
const DEFAULT_SERVICES_URL = "https://services.clawnify.com";

export interface RedlineEnv {
  /** Minted per org by the platform. Absent off-platform (`pnpm dev`). */
  CLAWNIFY_TOKEN?: string;
  /** Override for local testing against a dev services worker. */
  CLAWNIFY_SERVICES_URL?: string;
}

export interface RedlineEdit {
  anchor: string;
  replacement: string;
}

/** What the service made of one edit, in the order they were sent. */
export interface EditVerdict {
  index: number;
  /** applied | not_found | ambiguous | invalid */
  status: string;
  reason: string;
}

export type RedlineResult =
  | { ok: true; bytes: ArrayBuffer; revisions: number | null; verdicts: EditVerdict[] }
  | { ok: false; error: string; verdicts: EditVerdict[] };

export function redlineAvailable(env: RedlineEnv): boolean {
  return Boolean(env.CLAWNIFY_TOKEN);
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) on a multi-megabyte document blows
  // the argument limit and throws a RangeError that reads like a network fault.
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Compare the original against itself-with-the-edits-applied, and return the
 * redline bytes.
 *
 * The edits go over as *anchors*, not as a rewritten document. That distinction
 * is the reason the output is usable: the service mutates a copy of the real
 * file, so every clause nobody anchored comes back byte-identical and the
 * comparer finds only the changes that were actually asked for. A model asked
 * to reproduce the agreement instead would reflow prose it never meant to
 * touch, and the redline would report fifty changes with the real four buried.
 *
 * Bytes come back inline rather than as a presigned link: that link expires,
 * and a matter has to still have its redline months from now, so the file is
 * stored in this app's own bucket.
 */
export async function buildRedline(
  env: RedlineEnv,
  opts: { original: ArrayBuffer; edits: RedlineEdit[]; author: string; timeoutMs?: number },
): Promise<RedlineResult> {
  if (!redlineAvailable(env)) {
    return {
      ok: false,
      error: "This app can't reach the redline service — it is only available when deployed on Clawnify.",
      verdicts: [],
    };
  }

  const base = (env.CLAWNIFY_SERVICES_URL ?? DEFAULT_SERVICES_URL).replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/docx/redline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CLAWNIFY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        original: { data_base64: bytesToBase64(new Uint8Array(opts.original)) },
        edits: opts.edits,
        author: opts.author,
        output: "base64",
      }),
      // The service caps itself at five minutes; bound the hop a little inside
      // that so a wedged container surfaces here as a timeout rather than a
      // request that never returns.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4 * 60 * 1000),
    });
  } catch (err) {
    return { ok: false, error: `Could not reach the redline service: ${(err as Error).message}`, verdicts: [] };
  }

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: `The redline service returned ${res.status}`, verdicts: [] };
  }

  // Verdicts arrive on both paths and are worth keeping either way: on failure
  // they are the only explanation of *which* edits could not be applied, which
  // is exactly what the caller has to fix.
  const verdicts = (body.edits as EditVerdict[]) ?? [];

  if (!res.ok || !body.ok) {
    const detail = typeof body.detail === "string" ? body.detail : String(body.error ?? `HTTP ${res.status}`);
    return { ok: false, error: detail, verdicts };
  }

  return {
    ok: true,
    bytes: base64ToBytes(String(body.data_base64 ?? "")).buffer as ArrayBuffer,
    revisions: (body.revisions as number | null) ?? null,
    verdicts,
  };
}
