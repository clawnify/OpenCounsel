// Typed fetch wrapper. One place that knows the API returns JSON errors, so no
// screen has to remember to unwrap them.

export interface Matter {
  id: string;
  name: string;
  client: string;
  description: string;
  status: string;
  created_at: string;
  document_count?: number;
  review_count?: number;
}

export interface Document {
  id: string;
  matter_id: string;
  name: string;
  mime: string;
  size_bytes: number;
  page_count: number;
  locator_kind: string;
  extract_status: string;
  extract_error: string;
  created_at: string;
}

export interface ReviewColumn {
  id: string;
  key: string;
  question: string;
  hint: string;
  type: string;
  options: string;
  position: number;
}

export interface ReviewSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
  column_count: number;
  answered: number;
  rejected: number;
}

export interface Review {
  id: string;
  matter_id: string;
  name: string;
  status: string;
  created_at: string;
  columns: ReviewColumn[];
  document_count: number;
  answered: number;
  not_found: number;
  rejected: number;
}

export interface Cell {
  document_id: string;
  column_id: string;
  column_key: string;
  value: string;
  quote: string;
  page_no: number | null;
  status: string;
  rejected_reason: string;
  updated_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  columns: { key: string; question: string; hint?: string; type?: string; options?: string }[];
  /** Set when the workflow was copied from a bundled pack — drives attribution. */
  source_pack?: string;
  source_url?: string;
  author?: string;
  license?: string;
  created_at: string;
}

/** One proposed change, with the verdict on whether it can be made. */
export interface RevisionEdit {
  id: string;
  position: number;
  anchor: string;
  replacement: string;
  reason: string;
  page_no: number | null;
  /** proposed | rejected | excluded | applied | unapplied */
  status: string;
  rejected_reason: string;
}

export interface Revision {
  id: string;
  document_id: string;
  name: string;
  /** draft | building | ready | failed */
  status: string;
  author: string;
  revisions_found: number | null;
  redline_size: number;
  error: string;
  created_at: string;
  updated_at: string;
  edit_count?: number;
}

/** A bundled, practitioner-authored column set available to import. */
export interface Pack {
  id: string;
  name: string;
  description: string;
  practice: string;
  jurisdictions: string;
  column_count: number;
  author: string;
  license: string;
  source_url: string;
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  // 422 is not an error here — it is the verification result, and the caller
  // needs the body to show which cells were rejected and why.
  if (!res.ok && res.status !== 422) throw new ApiError(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  matters: (params = "") => request<{ matters: Matter[]; total: number }>(`/api/matters?${params}`),
  matter: (id: string) => request<Matter>(`/api/matters/${id}`),
  createMatter: (body: { name: string; client?: string; description?: string }) =>
    request<Matter>("/api/matters", { method: "POST", body: JSON.stringify(body) }),
  deleteMatter: (id: string) => request<{ ok: boolean }>(`/api/matters/${id}`, { method: "DELETE" }),

  documents: (matterId: string, params = "") =>
    request<{ documents: Document[]; total: number }>(`/api/matters/${matterId}/documents?${params}`),
  upload: (matterId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Document>(`/api/matters/${matterId}/documents`, { method: "POST", body: form });
  },
  extract: (id: string) => request<Document>(`/api/documents/${id}/extract`, { method: "POST" }),
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
  pages: (id: string, fromPage: number, limit = 5) =>
    request<{ document: { name: string; page_count: number; locator_kind: string }; pages: { page_no: number; text: string }[] }>(
      `/api/documents/${id}/pages?from_page=${fromPage}&limit=${limit}`,
    ),

  document: (id: string) => request<Document>(`/api/documents/${id}`),
  revisions: (documentId: string) =>
    request<{ revisions: Revision[]; total: number }>(`/api/documents/${documentId}/revisions?limit=50`),
  revision: (id: string) => request<{ revision: Revision; edits: RevisionEdit[] }>(`/api/revisions/${id}`),
  setEditIncluded: (revisionId: string, editId: string, include: boolean) =>
    request<{ revision: Revision; edits: RevisionEdit[] }>(`/api/revisions/${revisionId}/edits/${editId}`, {
      method: "PATCH",
      body: JSON.stringify({ include }),
    }),
  // 422 is a result, not a throw (see `request`): a build that could not be made
  // answers with `error`, one whose edits partly failed answers with the edits.
  buildRedline: (id: string) =>
    request<{ revision?: Revision; edits?: RevisionEdit[]; error?: string }>(`/api/revisions/${id}/build`, {
      method: "POST",
      body: "{}",
    }),
  deleteRevision: (id: string) => request<{ ok: boolean }>(`/api/revisions/${id}`, { method: "DELETE" }),
  proposeChanges: (documentId: string, instruction: string) =>
    request<{ dispatched: boolean; brief: string; error?: string }>(`/api/documents/${documentId}/propose`, {
      method: "POST",
      body: JSON.stringify({ instruction }),
    }),

  reviews: (matterId: string) => request<{ reviews: ReviewSummary[]; total: number }>(`/api/matters/${matterId}/reviews?limit=50`),
  review: (id: string) => request<Review>(`/api/reviews/${id}`),
  createReview: (matterId: string, body: Record<string, unknown>) =>
    request<{ id: string }>(`/api/matters/${matterId}/reviews`, { method: "POST", body: JSON.stringify(body) }),
  cells: (reviewId: string, params = "limit=100") =>
    request<{ cells: Cell[]; total: number }>(`/api/reviews/${reviewId}/cells?${params}`),
  runReview: (id: string) =>
    request<{ dispatched: boolean; brief: string; error?: string }>(`/api/reviews/${id}/run`, {
      method: "POST",
      body: "{}",
    }),

  agent: () =>
    request<{
      available: boolean;
      reachable: boolean;
      server_id: string | null;
      servers: { id: string; name: string | null; status: string | null }[];
    }>("/api/agent"),
  setAgentServer: (serverId: string | null) =>
    request<{ server_id: string | null }>("/api/agent", {
      method: "PUT",
      body: JSON.stringify({ server_id: serverId ?? "" }),
    }),
  deleteReview: (id: string) => request<{ ok: boolean }>(`/api/reviews/${id}`, { method: "DELETE" }),

  workflows: () => request<{ workflows: Workflow[]; total: number }>("/api/workflows?limit=50"),
  packs: () => request<{ packs: Pack[] }>("/api/workflow-packs"),
  importPack: (id: string) =>
    request<{ id: string; name: string; column_count: number }>(`/api/workflow-packs/${id}/import`, { method: "POST" }),
  createWorkflow: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/workflows", { method: "POST", body: JSON.stringify(body) }),
  deleteWorkflow: (id: string) => request<{ ok: boolean }>(`/api/workflows/${id}`, { method: "DELETE" }),
};
