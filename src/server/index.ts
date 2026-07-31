import { createApp, createRoute, user, z } from "@clawnify/app";
import { get, query, run } from "./db.js";
import { verifyQuote, type PageText } from "./citations.js";
import { extract, isSupported, UnsupportedFileError } from "./extract.js";
import { toCsv } from "./export.js";
import { catalogue, findPack } from "./packs.js";
import { dispatchAvailable, dispatchTask, listAgentServers, reviewBrief } from "./agent.js";

type Env = {
  Bindings: {
    DB: D1Database;
    /** Per-app R2 bucket holding the original files. */
    UPLOADS: R2Bucket;
    /** Minted per org by the platform; required to hand a review to the agent. */
    CLAWNIFY_TOKEN?: string;
    /** Override the platform agent endpoint — local testing only. */
    CLAWNIFY_AGENTS_URL?: string;
  };
};

// createApp bakes in OpenAPIHono construction, the per-request initDB
// middleware and /api/openapi.json + /llms.txt discovery.
const app = createApp<Env>({
  title: "Open Counsel",
  version: "1.0.0",
  description:
    "Matter-scoped legal document review. Upload contracts, define the questions once, and let the agent fill a review grid where every answer must carry a quote the app can actually find in the source.",
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || String(err) }, 500);
});

// ── Shared schemas ───────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const PaginationQuery = z.object({
  page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
  limit: z.string().optional().openapi({ description: "Items per page (default: 25, max: 100)" }),
});

function paginate(q: { page?: string; limit?: string }): { limit: number; offset: number; page: number } {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

function ok<T extends z.ZodTypeAny>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}
function fail(description: string) {
  return { description, content: { "application/json": { schema: ErrorSchema } } };
}

const MatterSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    client: z.string(),
    description: z.string(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    document_count: z.number().int().optional(),
    review_count: z.number().int().optional(),
  })
  .openapi("Matter");

const DocumentSchema = z
  .object({
    id: z.string(),
    matter_id: z.string(),
    name: z.string(),
    mime: z.string(),
    size_bytes: z.number().int(),
    page_count: z.number().int(),
    locator_kind: z.string(),
    extract_status: z.string(),
    extract_error: z.string(),
    created_at: z.string(),
  })
  .openapi("Document");

const ColumnSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    question: z.string(),
    hint: z.string(),
    type: z.string(),
    options: z.string(),
    position: z.number().int(),
  })
  .openapi("ReviewColumn");

const ColumnInput = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits and underscores only")
    .openapi({ description: "Stable handle the agent writes answers against, e.g. governing_law" }),
  question: z.string().min(1).openapi({ description: "The question asked of every document" }),
  hint: z
    .string()
    .optional()
    .openapi({
      description:
        "The detailed instruction for this column — what to look for, what to note. Sent to the agent with the question, so this is where the substance belongs.",
    }),
  type: z.enum(["text", "enum", "date", "money", "percentage", "bulleted_list", "boolean"]).optional(),
  options: z.string().optional().openapi({ description: "Comma-separated allowed values (enum only)" }),
});

/**
 * A column as it travels between a review and a saved workflow. Rows read back
 * out of SQLite are typed as this rather than re-validated: the only writer is
 * ColumnInput above, so the enum was already checked on the way in.
 */
type ColumnDef = z.infer<typeof ColumnInput>;

const CellSchema = z
  .object({
    document_id: z.string(),
    column_id: z.string(),
    column_key: z.string(),
    value: z.string(),
    quote: z.string(),
    page_no: z.number().int().nullable(),
    status: z.string(),
    rejected_reason: z.string(),
    updated_at: z.string(),
  })
  .openapi("ReviewCell");

// ── Helpers ──────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();

/**
 * Write a document's pages in as few statements as the database allows.
 *
 * One INSERT per page is the obvious loop and it fails in production only —
 * D1 caps a Worker invocation at 1000 queries, and a 900-page credit agreement
 * (measured: real, not hypothetical) sits right against that ceiling while the
 * local SQLite used in development enforces no such limit. Multi-row inserts
 * take the same document to ~30 statements.
 *
 * The two chunk bounds are both D1 limits, not guesses: 100 bound parameters
 * per query (3 per row → 33 rows), and a cap on how much payload one statement
 * may carry.
 */
const MAX_ROWS_PER_INSERT = 33;
const MAX_BYTES_PER_INSERT = 900_000;
/** D1's maximum row size is 2 MB; leave room for the rest of the row. */
const MAX_PAGE_CHARS = 1_800_000;

async function insertPages(docId: string, pages: { page_no: number; text: string }[]) {
  let batch: { page_no: number; text: string }[] = [];
  let bytes = 0;

  const flush = async () => {
    if (!batch.length) return;
    const values = batch.map(() => "(?, ?, ?)").join(", ");
    await run(
      `INSERT INTO document_pages (document_id, page_no, text) VALUES ${values}`,
      batch.flatMap((p) => [docId, p.page_no, p.text]),
    );
    batch = [];
    bytes = 0;
  };

  for (const page of pages) {
    const text = page.text.length > MAX_PAGE_CHARS ? page.text.slice(0, MAX_PAGE_CHARS) : page.text;
    if (batch.length >= MAX_ROWS_PER_INSERT || bytes + text.length > MAX_BYTES_PER_INSERT) {
      await flush();
    }
    batch.push({ page_no: page.page_no, text });
    bytes += text.length;
  }
  await flush();
}

async function matterOr404(id: string) {
  return get<{ id: string; name: string }>("SELECT id, name FROM matters WHERE id = ?", [id]);
}

async function countOf(sql: string, params: unknown[] = []): Promise<number> {
  const row = await get<{ n: number }>(sql, params);
  return row?.n ?? 0;
}

// ── Matters ──────────────────────────────────────────────────────────

const listMatters = createRoute({
  method: "get",
  path: "/api/matters",
  tags: ["Matters"],
  summary: "List matters, newest first",
  request: {
    query: PaginationQuery.extend({
      search: z.string().optional().openapi({ description: "Free-text match on name or client" }),
      status: z.enum(["open", "closed"]).optional(),
    }),
  },
  responses: {
    200: ok("A page of matters", z.object({ matters: z.array(MatterSchema), total: z.number().int(), page: z.number().int() })),
  },
});

app.openapi(listMatters, async (c) => {
  const q = c.req.valid("query");
  const { limit, offset, page } = paginate(q);

  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search) {
    where.push("(name LIKE ? OR client LIKE ?)");
    params.push(`%${q.search}%`, `%${q.search}%`);
  }
  if (q.status) {
    where.push("status = ?");
    params.push(q.status);
  }
  const whereSQL = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  const matters = await query<Record<string, unknown>>(
    `SELECT m.*,
            (SELECT COUNT(*) FROM documents d WHERE d.matter_id = m.id) AS document_count,
            (SELECT COUNT(*) FROM reviews r WHERE r.matter_id = m.id)   AS review_count
       FROM matters m${whereSQL}
      ORDER BY m.created_at DESC, m.id
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = await countOf(`SELECT COUNT(*) AS n FROM matters${whereSQL}`, params);

  return c.json({ matters, total, page } as never);
});

const createMatter = createRoute({
  method: "post",
  path: "/api/matters",
  tags: ["Matters"],
  summary: "Open a new matter",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1),
            client: z.string().optional(),
            description: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: { 201: ok("The created matter", MatterSchema) },
});

app.openapi(createMatter, async (c) => {
  const body = c.req.valid("json");
  const id = uid();
  await run("INSERT INTO matters (id, name, client, description, created_by) VALUES (?, ?, ?, ?, ?)", [
    id,
    body.name,
    body.client ?? "",
    body.description ?? "",
    user(c)?.id ?? "",
  ]);
  const matter = await get<Record<string, unknown>>("SELECT * FROM matters WHERE id = ?", [id]);
  return c.json(matter as never, 201);
});

const getMatter = createRoute({
  method: "get",
  path: "/api/matters/{id}",
  tags: ["Matters"],
  summary: "One matter with its document and review counts",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("The matter", MatterSchema), 404: fail("No such matter") },
});

app.openapi(getMatter, async (c) => {
  const { id } = c.req.valid("param");
  const matter = await get<Record<string, unknown>>(
    `SELECT m.*,
            (SELECT COUNT(*) FROM documents d WHERE d.matter_id = m.id) AS document_count,
            (SELECT COUNT(*) FROM reviews r WHERE r.matter_id = m.id)   AS review_count
       FROM matters m WHERE m.id = ?`,
    [id],
  );
  if (!matter) return c.json({ error: "No such matter" } as never, 404);
  return c.json(matter as never);
});

const updateMatter = createRoute({
  method: "patch",
  path: "/api/matters/{id}",
  tags: ["Matters"],
  summary: "Rename a matter, or open/close it",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).optional(),
            client: z.string().optional(),
            description: z.string().optional(),
            status: z.enum(["open", "closed"]).optional(),
          }),
        },
      },
    },
  },
  responses: { 200: ok("The updated matter", MatterSchema), 404: fail("No such matter") },
});

app.openapi(updateMatter, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  if (!(await matterOr404(id))) return c.json({ error: "No such matter" } as never, 404);

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const field of ["name", "client", "description", "status"] as const) {
    if (body[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push(body[field]);
    }
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    await run(`UPDATE matters SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  const matter = await get<Record<string, unknown>>("SELECT * FROM matters WHERE id = ?", [id]);
  return c.json(matter as never);
});

const deleteMatter = createRoute({
  method: "delete",
  path: "/api/matters/{id}",
  tags: ["Matters"],
  summary: "Delete a matter and everything filed under it",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema), 404: fail("No such matter") },
});

app.openapi(deleteMatter, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await matterOr404(id))) return c.json({ error: "No such matter" } as never, 404);

  // Take the files out of R2 before the rows that name them — a dropped row
  // would otherwise leave objects nobody can find or bill for.
  const docs = await query<{ r2_key: string }>("SELECT r2_key FROM documents WHERE matter_id = ?", [id]);
  await Promise.all(docs.map((d) => c.env.UPLOADS.delete(d.r2_key)));

  await run("DELETE FROM matters WHERE id = ?", [id]);
  return c.json({ ok: true } as never);
});

// ── Documents ────────────────────────────────────────────────────────

const listDocuments = createRoute({
  method: "get",
  path: "/api/matters/{id}/documents",
  tags: ["Documents"],
  summary: "List the documents filed under a matter",
  request: { params: z.object({ id: z.string() }), query: PaginationQuery },
  responses: {
    200: ok("A page of documents", z.object({ documents: z.array(DocumentSchema), total: z.number().int(), page: z.number().int() })),
  },
});

app.openapi(listDocuments, async (c) => {
  const { id } = c.req.valid("param");
  const { limit, offset, page } = paginate(c.req.valid("query"));
  const documents = await query<Record<string, unknown>>(
    "SELECT * FROM documents WHERE matter_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
    [id, limit, offset],
  );
  const total = await countOf("SELECT COUNT(*) AS n FROM documents WHERE matter_id = ?", [id]);
  return c.json({ documents, total, page } as never);
});

const uploadDocument = createRoute({
  method: "post",
  path: "/api/matters/{id}/documents",
  tags: ["Documents"],
  summary: "Upload a document and extract its text",
  description:
    "Accepts PDF, DOCX and plain text. Text is extracted synchronously and stored page by page — until extract_status is 'ready', no citation against this document can be verified.",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    201: ok("The stored document", DocumentSchema),
    404: fail("No such matter"),
    415: fail("The file has no text layer we can read"),
  },
});

app.openapi(uploadDocument, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await matterOr404(id))) return c.json({ error: "No such matter" } as never, 404);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "No file in the request" } as never, 415);

  const mime = file.type || "";
  // Rejected on the filename before a byte is stored — a caller uploading a
  // .doc should not wait for a round trip to hear it cannot be read.
  if (!isSupported(file.name, mime)) {
    return c.json(
      {
        error: `${file.name}: only PDF, DOCX and plain text can be read. Legacy .doc and scanned images have no text layer — convert to PDF (with OCR if scanned) and upload that.`,
      } as never,
      415,
    );
  }

  const docId = uid();
  const r2Key = `documents/${id}/${docId}`;
  const bytes = await file.arrayBuffer();
  await c.env.UPLOADS.put(r2Key, bytes, { httpMetadata: { contentType: mime || "application/octet-stream" } });

  await run(
    "INSERT INTO documents (id, matter_id, name, r2_key, mime, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    [docId, id, file.name, r2Key, mime, bytes.byteLength],
  );

  // Upload ends here, at the speed of an R2 put. Reading the text is a separate
  // call: extracting a 900-page agreement took 43 seconds in production, and
  // doing it inside the upload meant the user watched a dead button for all of
  // it with no idea whether anything was happening. The document now appears
  // immediately as `pending`, and the client extracts it as a second step it
  // can show progress for, per document.
  const doc = await get<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", [docId]);
  return c.json(doc as never, 201);
});

const extractDocument = createRoute({
  method: "post",
  path: "/api/documents/{id}/extract",
  tags: ["Documents"],
  summary: "Read a pending document's text",
  description:
    "The second half of an upload. Idempotent: a document that is already ready is returned untouched, so a retry after a dropped connection costs nothing. Call this on any document left `pending` — the upload stores the file, this is what makes it citable.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok("The document, now ready or failed", DocumentSchema),
    404: fail("No such document"),
  },
});

app.openapi(extractDocument, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<{ id: string; name: string; mime: string; r2_key: string; extract_status: string }>(
    "SELECT id, name, mime, r2_key, extract_status FROM documents WHERE id = ?",
    [id],
  );
  if (!doc) return c.json({ error: "No such document" } as never, 404);

  if (doc.extract_status === "ready") {
    const current = await get<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", [id]);
    return c.json(current as never);
  }

  const object = await c.env.UPLOADS.get(doc.r2_key);
  if (!object) {
    await run("UPDATE documents SET extract_status = 'failed', extract_error = ? WHERE id = ?", [
      "the stored file is missing",
      id,
    ]);
  } else {
    try {
      const bytes = await object.arrayBuffer();
      const { pages, locatorKind } = await extract(bytes, doc.name, doc.mime);
      // Re-runnable: a retry after a partial write must not double the pages.
      await run("DELETE FROM document_pages WHERE document_id = ?", [id]);
      await insertPages(id, pages);
      await run(
        "UPDATE documents SET page_count = ?, locator_kind = ?, extract_status = 'ready', extract_error = '' WHERE id = ?",
        [pages.length, locatorKind, id],
      );
    } catch (err) {
      // The file is kept: a failed extraction is recoverable (re-run OCR and
      // re-upload), and deleting the user's upload on our failure is not our call.
      const message =
        err instanceof UnsupportedFileError ? err.message : `Extraction failed: ${(err as Error).message}`;
      await run("UPDATE documents SET extract_status = 'failed', extract_error = ? WHERE id = ?", [
        message.slice(0, 500),
        id,
      ]);
    }
  }

  const updated = await get<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", [id]);
  return c.json(updated as never);
});

const getDocumentPages = createRoute({
  method: "get",
  path: "/api/documents/{id}/pages",
  tags: ["Documents"],
  summary: "Read a document's extracted text, one page at a time",
  description:
    "This is how you read a document. Paginated because a long agreement would otherwise bury the caller in text — read every page before answering, not just the first.",
  request: {
    params: z.object({ id: z.string() }),
    query: PaginationQuery.extend({
      from_page: z.string().optional().openapi({ description: "Start at this page number" }),
    }),
  },
  responses: {
    200: ok(
      "A page of pages",
      z.object({
        document: z.object({ id: z.string(), name: z.string(), page_count: z.number().int(), locator_kind: z.string() }),
        pages: z.array(z.object({ page_no: z.number().int(), text: z.string() })),
        total: z.number().int(),
        page: z.number().int(),
      }),
    ),
    404: fail("No such document"),
  },
});

app.openapi(getDocumentPages, async (c) => {
  const { id } = c.req.valid("param");
  const q = c.req.valid("query");
  const doc = await get<{ id: string; name: string; page_count: number; locator_kind: string }>(
    "SELECT id, name, page_count, locator_kind FROM documents WHERE id = ?",
    [id],
  );
  if (!doc) return c.json({ error: "No such document" } as never, 404);

  // Default to 5 pages: enough to keep a read moving, small enough that a
  // careless caller doesn't pull a 300-page agreement into one response.
  const limit = Math.min(50, Math.max(1, Number(q.limit) || 5));
  const from = Number(q.from_page) || 0;
  const offset = from > 0 ? 0 : (Math.max(1, Number(q.page) || 1) - 1) * limit;
  const where = from > 0 ? "AND page_no >= ?" : "";
  const params = from > 0 ? [id, from, limit] : [id, limit, offset];

  const pages = await query<{ page_no: number; text: string }>(
    `SELECT page_no, text FROM document_pages WHERE document_id = ? ${where} ORDER BY page_no LIMIT ?${from > 0 ? "" : " OFFSET ?"}`,
    params,
  );

  return c.json({ document: doc, pages, total: doc.page_count, page: Math.max(1, Number(q.page) || 1) } as never);
});

const getDocumentFile = createRoute({
  method: "get",
  path: "/api/documents/{id}/file",
  tags: ["Documents"],
  summary: "Download the original file",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "The stored file", content: { "application/octet-stream": { schema: z.any() } } },
    404: fail("No such document"),
  },
});

app.openapi(getDocumentFile, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<{ r2_key: string; mime: string; name: string }>(
    "SELECT r2_key, mime, name FROM documents WHERE id = ?",
    [id],
  );
  if (!doc) return c.json({ error: "No such document" } as never, 404);

  const obj = await c.env.UPLOADS.get(doc.r2_key);
  if (!obj) return c.json({ error: "The stored file is missing" } as never, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": doc.mime || "application/octet-stream",
      // inline: the point is to read it beside the grid, not to download it
      "Content-Disposition": `inline; filename="${doc.name.replace(/"/g, "")}"`,
    },
  }) as never;
});

const deleteDocument = createRoute({
  method: "delete",
  path: "/api/documents/{id}",
  tags: ["Documents"],
  summary: "Remove a document, its text and its cells",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema), 404: fail("No such document") },
});

app.openapi(deleteDocument, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<{ r2_key: string }>("SELECT r2_key FROM documents WHERE id = ?", [id]);
  if (!doc) return c.json({ error: "No such document" } as never, 404);

  await c.env.UPLOADS.delete(doc.r2_key);
  await run("DELETE FROM documents WHERE id = ?", [id]);
  return c.json({ ok: true } as never);
});

// ── Reviews ──────────────────────────────────────────────────────────

const listReviews = createRoute({
  method: "get",
  path: "/api/matters/{id}/reviews",
  tags: ["Reviews"],
  summary: "List the reviews on a matter",
  request: { params: z.object({ id: z.string() }), query: PaginationQuery },
  responses: {
    200: ok(
      "A page of reviews",
      z.object({
        reviews: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            status: z.string(),
            created_at: z.string(),
            column_count: z.number().int(),
            answered: z.number().int(),
            rejected: z.number().int(),
          }),
        ),
        total: z.number().int(),
        page: z.number().int(),
      }),
    ),
  },
});

app.openapi(listReviews, async (c) => {
  const { id } = c.req.valid("param");
  const { limit, offset, page } = paginate(c.req.valid("query"));
  const reviews = await query<Record<string, unknown>>(
    `SELECT r.id, r.name, r.status, r.created_at,
            (SELECT COUNT(*) FROM review_columns rc WHERE rc.review_id = r.id) AS column_count,
            (SELECT COUNT(*) FROM review_cells x WHERE x.review_id = r.id AND x.status = 'answered') AS answered,
            (SELECT COUNT(*) FROM review_cells x WHERE x.review_id = r.id AND x.status = 'rejected') AS rejected
       FROM reviews r WHERE r.matter_id = ?
      ORDER BY r.created_at DESC, r.id LIMIT ? OFFSET ?`,
    [id, limit, offset],
  );
  const total = await countOf("SELECT COUNT(*) AS n FROM reviews WHERE matter_id = ?", [id]);
  return c.json({ reviews, total, page } as never);
});

const createReview = createRoute({
  method: "post",
  path: "/api/matters/{id}/reviews",
  tags: ["Reviews"],
  summary: "Start a review — from explicit columns or a saved workflow",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1),
            workflow_id: z.string().optional().openapi({ description: "Copy the columns from this saved workflow" }),
            columns: z.array(ColumnInput).optional().openapi({ description: "Or define them inline" }),
          }),
        },
      },
    },
  },
  responses: {
    201: ok("The created review with its columns", z.object({ id: z.string(), name: z.string(), status: z.string(), columns: z.array(ColumnSchema) })),
    400: fail("No columns given"),
    404: fail("No such matter or workflow"),
  },
});

app.openapi(createReview, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  if (!(await matterOr404(id))) return c.json({ error: "No such matter" } as never, 404);

  let columns = body.columns ?? [];
  if (body.workflow_id) {
    const wf = await get<{ columns_json: string }>("SELECT columns_json FROM workflows WHERE id = ?", [body.workflow_id]);
    if (!wf) return c.json({ error: "No such workflow" } as never, 404);
    columns = JSON.parse(wf.columns_json) as typeof columns;
  }
  if (!columns.length) {
    return c.json({ error: "A review needs at least one column — the questions are the review" } as never, 400);
  }

  const reviewId = uid();
  await run("INSERT INTO reviews (id, matter_id, name) VALUES (?, ?, ?)", [reviewId, id, body.name]);
  for (const [i, col] of columns.entries()) {
    await run(
      "INSERT INTO review_columns (id, review_id, position, key, question, hint, type, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [uid(), reviewId, i, col.key, col.question, col.hint ?? "", col.type ?? "text", col.options ?? ""],
    );
  }

  const cols = await query<Record<string, unknown>>(
    "SELECT * FROM review_columns WHERE review_id = ? ORDER BY position",
    [reviewId],
  );
  return c.json({ id: reviewId, name: body.name, status: "draft", columns: cols } as never, 201);
});

const getReview = createRoute({
  method: "get",
  path: "/api/reviews/{id}",
  tags: ["Reviews"],
  summary: "A review's columns and progress — not its cells",
  description: "Cells are fetched separately and paginated; this returns only the shape of the grid and how much of it is filled.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok(
      "The review",
      z.object({
        id: z.string(),
        matter_id: z.string(),
        name: z.string(),
        status: z.string(),
        created_at: z.string(),
        columns: z.array(ColumnSchema),
        document_count: z.number().int(),
        answered: z.number().int(),
        not_found: z.number().int(),
        rejected: z.number().int(),
      }),
    ),
    404: fail("No such review"),
  },
});

app.openapi(getReview, async (c) => {
  const { id } = c.req.valid("param");
  const review = await get<Record<string, unknown>>("SELECT * FROM reviews WHERE id = ?", [id]);
  if (!review) return c.json({ error: "No such review" } as never, 404);

  const columns = await query<Record<string, unknown>>(
    "SELECT * FROM review_columns WHERE review_id = ? ORDER BY position",
    [id],
  );
  const documentCount = await countOf(
    "SELECT COUNT(*) AS n FROM documents WHERE matter_id = (SELECT matter_id FROM reviews WHERE id = ?)",
    [id],
  );
  const counts = await get<{ answered: number; not_found: number; rejected: number }>(
    `SELECT SUM(status = 'answered')  AS answered,
            SUM(status = 'not_found') AS not_found,
            SUM(status = 'rejected')  AS rejected
       FROM review_cells WHERE review_id = ?`,
    [id],
  );

  return c.json({
    ...review,
    columns,
    document_count: documentCount,
    answered: counts?.answered ?? 0,
    not_found: counts?.not_found ?? 0,
    rejected: counts?.rejected ?? 0,
  } as never);
});

const listCells = createRoute({
  method: "get",
  path: "/api/reviews/{id}/cells",
  tags: ["Reviews"],
  summary: "The filled cells of a review, by document",
  request: {
    params: z.object({ id: z.string() }),
    query: PaginationQuery.extend({
      document_id: z.string().optional().openapi({ description: "Only this document's row" }),
      status: z.enum(["answered", "not_found", "rejected"]).optional(),
    }),
  },
  responses: {
    200: ok("A page of cells", z.object({ cells: z.array(CellSchema), total: z.number().int(), page: z.number().int() })),
  },
});

app.openapi(listCells, async (c) => {
  const { id } = c.req.valid("param");
  const q = c.req.valid("query");
  const { limit, offset, page } = paginate(q);

  const where = ["c.review_id = ?"];
  const params: unknown[] = [id];
  if (q.document_id) {
    where.push("c.document_id = ?");
    params.push(q.document_id);
  }
  if (q.status) {
    where.push("c.status = ?");
    params.push(q.status);
  }
  const whereSQL = ` WHERE ${where.join(" AND ")}`;

  const cells = await query<Record<string, unknown>>(
    `SELECT c.document_id, c.column_id, rc.key AS column_key, c.value, c.quote,
            c.page_no, c.status, c.rejected_reason, c.updated_at
       FROM review_cells c JOIN review_columns rc ON rc.id = c.column_id${whereSQL}
      ORDER BY c.document_id, rc.position LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = await countOf(`SELECT COUNT(*) AS n FROM review_cells c${whereSQL}`, params);
  return c.json({ cells, total, page } as never);
});

// The verified write. Everything else in this file exists to make this endpoint
// possible; this is the one that decides what the app is worth.
const putCells = createRoute({
  method: "post",
  path: "/api/reviews/{id}/cells",
  tags: ["Reviews"],
  summary: "Submit answers — every quote is checked against the document text",
  description:
    "Each answer must carry a quote copied verbatim from the document. The quote is located in the extracted text before the answer is stored; if it cannot be found the cell is saved as 'rejected' and shown to the user as unresolved, never as an answer. Send status 'not_found' (no quote needed) when a document genuinely does not address a column. Accepted cells persist even when others are rejected, so a retry only needs to re-send the failures.",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            cells: z
              .array(
                z.object({
                  document_id: z.string(),
                  column: z.string().openapi({ description: "The column's key, e.g. governing_law" }),
                  value: z.string().optional(),
                  quote: z.string().optional().openapi({ description: "Verbatim text from the document" }),
                  page: z.number().int().optional().openapi({ description: "Page the quote appears on" }),
                  status: z.enum(["answered", "not_found"]).optional(),
                }),
              )
              .min(1)
              .max(100),
          }),
        },
      },
    },
  },
  responses: {
    200: ok(
      "Every cell was accepted",
      z.object({ accepted: z.number().int(), rejected: z.array(z.object({ document_id: z.string(), column: z.string(), reason: z.string(), found_on_page: z.number().int().optional() })) }),
    ),
    422: ok(
      "At least one cell failed verification. Accepted cells were still stored.",
      z.object({ accepted: z.number().int(), rejected: z.array(z.object({ document_id: z.string(), column: z.string(), reason: z.string(), found_on_page: z.number().int().optional() })) }),
    ),
    404: fail("No such review"),
  },
});

app.openapi(putCells, async (c) => {
  const { id } = c.req.valid("param");
  const { cells } = c.req.valid("json");

  const review = await get<{ id: string; matter_id: string }>("SELECT id, matter_id FROM reviews WHERE id = ?", [id]);
  if (!review) return c.json({ error: "No such review" } as never, 404);

  const columns = await query<{ id: string; key: string }>("SELECT id, key FROM review_columns WHERE review_id = ?", [id]);
  const columnByKey = new Map(columns.map((col) => [col.key, col.id]));

  // Page text is fetched once per document, not once per cell: a 12-column
  // review of one agreement would otherwise re-read the whole document twelve
  // times to check twelve quotes.
  const pageCache = new Map<string, PageText[]>();
  async function pagesOf(documentId: string): Promise<PageText[]> {
    const cached = pageCache.get(documentId);
    if (cached) return cached;
    const pages = await query<PageText>(
      "SELECT page_no, text FROM document_pages WHERE document_id = ? ORDER BY page_no",
      [documentId],
    );
    pageCache.set(documentId, pages);
    return pages;
  }

  const rejected: { document_id: string; column: string; reason: string; found_on_page?: number }[] = [];
  let accepted = 0;

  for (const cell of cells) {
    const columnId = columnByKey.get(cell.column);
    if (!columnId) {
      rejected.push({
        document_id: cell.document_id,
        column: cell.column,
        reason: `no column with key "${cell.column}" in this review (have: ${columns.map((x) => x.key).join(", ")})`,
      });
      continue;
    }

    const belongs = await get<{ id: string }>(
      "SELECT id FROM documents WHERE id = ? AND matter_id = ?",
      [cell.document_id, review.matter_id],
    );
    if (!belongs) {
      rejected.push({
        document_id: cell.document_id,
        column: cell.column,
        reason: "that document is not filed under this review's matter",
      });
      continue;
    }

    // The honest escape hatch. Without it, an agent facing a document that
    // simply doesn't mention indemnities has only one way to fill the cell:
    // invent something. Make the truthful answer the easy one.
    if (cell.status === "not_found") {
      await upsertCell(id, cell.document_id, columnId, { value: "", quote: "", page: null, status: "not_found", reason: "" });
      accepted++;
      continue;
    }

    const verdict = verifyQuote(cell.quote ?? "", cell.page ?? null, await pagesOf(cell.document_id));
    if (!verdict.ok) {
      await upsertCell(id, cell.document_id, columnId, {
        value: cell.value ?? "",
        quote: cell.quote ?? "",
        page: cell.page ?? null,
        status: "rejected",
        reason: verdict.reason,
      });
      rejected.push({
        document_id: cell.document_id,
        column: cell.column,
        reason: verdict.reason,
        ...(verdict.foundOnPage !== undefined ? { found_on_page: verdict.foundOnPage } : {}),
      });
      continue;
    }

    await upsertCell(id, cell.document_id, columnId, {
      value: cell.value ?? "",
      quote: cell.quote ?? "",
      page: verdict.page,
      status: "answered",
      reason: "",
    });
    accepted++;
  }

  // Advance the review's own status from what actually landed, so the UI can
  // tell "the agent is still working" from "the agent has finished" without
  // anyone having to report completion. A cell is covered whatever its verdict
  // — an unresolved cell is a finished attempt, not an outstanding one.
  const covered = await countOf("SELECT COUNT(*) AS n FROM review_cells WHERE review_id = ?", [id]);
  const expected =
    (await countOf("SELECT COUNT(*) AS n FROM documents WHERE matter_id = ? AND extract_status = 'ready'", [
      review.matter_id,
    ])) * (await countOf("SELECT COUNT(*) AS n FROM review_columns WHERE review_id = ?", [id]));

  await run("UPDATE reviews SET status = ?, updated_at = datetime('now') WHERE id = ?", [
    expected > 0 && covered >= expected ? "complete" : "running",
    id,
  ]);

  return c.json({ accepted, rejected } as never, rejected.length ? 422 : 200);
});

async function upsertCell(
  reviewId: string,
  documentId: string,
  columnId: string,
  data: { value: string; quote: string; page: number | null; status: string; reason: string },
) {
  await run(
    `INSERT INTO review_cells (id, review_id, document_id, column_id, value, quote, page_no, status, rejected_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (review_id, document_id, column_id) DO UPDATE SET
       value = excluded.value, quote = excluded.quote, page_no = excluded.page_no,
       status = excluded.status, rejected_reason = excluded.rejected_reason,
       updated_at = datetime('now')`,
    [uid(), reviewId, documentId, columnId, data.value, data.quote, data.page, data.status, data.reason],
  );
}

// ── Agent handoff ───────────────────────────────────────────────────
//
// A review runs on the org's agent, not in this app: reading long legal prose
// is judgment work that takes minutes. These routes are the handoff.
//
// They are deliberately NOT on the OpenAPI surface. The agent is the *target*
// of a dispatch, so publishing `/run` would let it hand a review to itself — a
// loop the app has no way to break — and every published route costs context in
// every agent turn. The agent's side of this contract is the routes it already
// has: GET /api/documents/{id}/pages and POST /api/reviews/{id}/cells.

/** The chosen agent, or null to let the platform resolve a single-agent org. */
async function configuredServerId(): Promise<string | null> {
  const row = await get<{ server_id: string }>("SELECT server_id FROM agent_config WHERE id = 1");
  return row?.server_id || null;
}

app.get("/api/agent", async (c) => {
  const servers = await listAgentServers(c.env);
  return c.json({
    // Distinct on purpose: "this deployment has no platform token" (off-platform)
    // is a different problem from "the platform didn't answer" (transient).
    available: dispatchAvailable(c.env),
    reachable: servers !== null,
    server_id: await configuredServerId(),
    servers: servers ?? [],
  });
});

app.put("/api/agent", async (c) => {
  let body: { server_id?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const wanted = typeof body.server_id === "string" ? body.server_id.trim() : "";

  // Validated against the live list rather than stored blind: a mistyped or
  // decommissioned id would otherwise wedge every future review behind a
  // platform 404 the user has no way to interpret.
  if (wanted) {
    const servers = await listAgentServers(c.env);
    if (servers === null) return c.json({ error: "Can't reach the platform to verify that agent." }, 503);
    if (!servers.some((s) => s.id === wanted)) return c.json({ error: "That agent isn't in your organization." }, 400);
  }

  await run(
    `INSERT INTO agent_config (id, server_id, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET server_id = excluded.server_id, updated_at = excluded.updated_at`,
    [wanted],
  );
  return c.json({ server_id: wanted || null });
});

/** Hand a review to the agent. Returns the brief either way, so an unreachable
 *  platform degrades to "paste this into chat" rather than a dead end. */
app.post("/api/reviews/:id/run", async (c) => {
  const id = c.req.param("id");

  const review = await get<{ id: string; name: string; matter_id: string }>(
    "SELECT id, name, matter_id FROM reviews WHERE id = ?",
    [id],
  );
  if (!review) return c.json({ error: "No such review" }, 404);

  const columns = await query<{ key: string; question: string; hint: string; type: string; options: string }>(
    "SELECT key, question, hint, type, options FROM review_columns WHERE review_id = ? ORDER BY position",
    [id],
  );
  const documentCount = await countOf(
    "SELECT COUNT(*) AS n FROM documents WHERE matter_id = ? AND extract_status = 'ready'",
    [review.matter_id],
  );

  const brief = reviewBrief({
    reviewId: id,
    reviewName: review.name,
    appUrl: new URL(c.req.url).origin,
    documentCount,
    questions: columns,
  });

  const result = await dispatchTask(c.env, {
    instruction: brief,
    serverId: await configuredServerId(),
    // Keyed on the review *and* how many documents it covers, so re-running
    // after more documents arrive is a new task rather than a silently
    // deduplicated repeat of the first one.
    idempotencyKey: `review:${id}:${documentCount}`,
  });

  if (result.ok) {
    await run("UPDATE reviews SET status = 'running', updated_at = datetime('now') WHERE id = ?", [id]);
    return c.json({ dispatched: true, brief });
  }
  return c.json({ dispatched: false, brief, error: result.error, servers: result.servers });
});

const exportReview = createRoute({
  method: "get",
  path: "/api/reviews/{id}/export.csv",
  tags: ["Reviews"],
  summary: "Download the grid as CSV, with the page and quote beside every answer",
  description: "A human download, not an agent read — it is deliberately unpaginated and will be large. Use /api/reviews/{id}/cells to inspect answers programmatically.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "The grid", content: { "text/csv": { schema: z.string() } } },
    404: fail("No such review"),
  },
});

app.openapi(exportReview, async (c) => {
  const { id } = c.req.valid("param");
  const review = await get<{ name: string; matter_id: string }>("SELECT name, matter_id FROM reviews WHERE id = ?", [id]);
  if (!review) return c.json({ error: "No such review" } as never, 404);

  const columns = await query<{ id: string; key: string; question: string }>(
    "SELECT id, key, question FROM review_columns WHERE review_id = ? ORDER BY position",
    [id],
  );
  // Bounded so a runaway matter can't turn an export into an unbounded read.
  const documents = await query<{ id: string; name: string }>(
    "SELECT id, name FROM documents WHERE matter_id = ? ORDER BY name LIMIT 2000",
    [review.matter_id],
  );
  const cells = await query<{
    document_id: string;
    column_id: string;
    value: string;
    quote: string;
    page_no: number | null;
    status: string;
  }>("SELECT document_id, column_id, value, quote, page_no, status FROM review_cells WHERE review_id = ?", [id]);

  const filename = `${review.name.replace(/[^\w -]+/g, "").trim() || "review"}.csv`;
  return new Response(toCsv(documents, columns, cells), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  }) as never;
});

const deleteReview = createRoute({
  method: "delete",
  path: "/api/reviews/{id}",
  tags: ["Reviews"],
  summary: "Delete a review and its cells",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema) },
});

app.openapi(deleteReview, async (c) => {
  await run("DELETE FROM reviews WHERE id = ?", [c.req.valid("param").id]);
  return c.json({ ok: true } as never);
});

// ── Workflows ────────────────────────────────────────────────────────

const listWorkflows = createRoute({
  method: "get",
  path: "/api/workflows",
  tags: ["Workflows"],
  summary: "Saved column sets the firm reuses",
  request: { query: PaginationQuery },
  responses: {
    200: ok(
      "A page of workflows",
      z.object({
        workflows: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            columns: z.array(ColumnInput),
            created_at: z.string(),
          }),
        ),
        total: z.number().int(),
        page: z.number().int(),
      }),
    ),
  },
});

app.openapi(listWorkflows, async (c) => {
  const { limit, offset, page } = paginate(c.req.valid("query"));
  const rows = await query<{
    id: string; name: string; description: string; columns_json: string;
    source_pack: string; source_url: string; author: string; license: string; created_at: string;
  }>(
    "SELECT * FROM workflows ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
    [limit, offset],
  );
  const workflows = rows.map(({ columns_json, ...w }) => ({ ...w, columns: JSON.parse(columns_json) }));
  const total = await countOf("SELECT COUNT(*) AS n FROM workflows");
  return c.json({ workflows, total, page } as never);
});

const createWorkflow = createRoute({
  method: "post",
  path: "/api/workflows",
  tags: ["Workflows"],
  summary: "Save a column set for reuse",
  description: "Pass from_review_id to capture the columns of a review that worked, rather than retyping them.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            columns: z.array(ColumnInput).optional(),
            from_review_id: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: { 201: ok("The saved workflow", z.object({ id: z.string(), name: z.string() })), 400: fail("No columns given") },
});

app.openapi(createWorkflow, async (c) => {
  const body = c.req.valid("json");
  let columns: ColumnDef[] = body.columns ?? [];

  if (body.from_review_id) {
    columns = await query<ColumnDef>(
      "SELECT key, question, hint, type, options FROM review_columns WHERE review_id = ? ORDER BY position",
      [body.from_review_id],
    );
  }
  if (!columns.length) return c.json({ error: "A workflow is its columns — give at least one" } as never, 400);

  const id = uid();
  await run("INSERT INTO workflows (id, name, description, columns_json) VALUES (?, ?, ?, ?)", [
    id,
    body.name,
    body.description ?? "",
    JSON.stringify(columns),
  ]);
  return c.json({ id, name: body.name } as never, 201);
});

const listPacks = createRoute({
  method: "get",
  path: "/api/workflow-packs",
  tags: ["Workflows"],
  summary: "The bundled library of review column sets",
  description:
    "A small fixed catalogue, so it returns every entry. Columns are omitted here — import a pack, or read one, to get them.",
  responses: {
    200: ok(
      "The bundled packs",
      z.object({
        packs: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            practice: z.string(),
            jurisdictions: z.string(),
            column_count: z.number().int(),
            author: z.string(),
            license: z.string(),
            source_url: z.string(),
          }),
        ),
      }),
    ),
  },
});

app.openapi(listPacks, async (c) => c.json({ packs: catalogue() } as never));

const importPack = createRoute({
  method: "post",
  path: "/api/workflow-packs/{id}/import",
  tags: ["Workflows"],
  summary: "Copy a bundled pack into this firm's workflows",
  description:
    "Copies, deliberately: the workflow becomes the firm's to edit, and refreshing the bundled library later cannot change a review that has already been run against it.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    201: ok("The imported workflow", z.object({ id: z.string(), name: z.string(), column_count: z.number().int() })),
    404: fail("No such pack"),
  },
});

app.openapi(importPack, async (c) => {
  const pack = findPack(c.req.valid("param").id);
  if (!pack) return c.json({ error: "No such pack" } as never, 404);

  const id = uid();
  await run(
    `INSERT INTO workflows (id, name, description, columns_json, source_pack, source_url, author, license)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      pack.name,
      pack.description,
      JSON.stringify(pack.columns),
      pack.id,
      pack.provenance.source_url,
      pack.provenance.author,
      pack.provenance.license,
    ],
  );
  return c.json({ id, name: pack.name, column_count: pack.columns.length } as never, 201);
});

const deleteWorkflow = createRoute({
  method: "delete",
  path: "/api/workflows/{id}",
  tags: ["Workflows"],
  summary: "Delete a saved workflow",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema) },
});

app.openapi(deleteWorkflow, async (c) => {
  await run("DELETE FROM workflows WHERE id = ?", [c.req.valid("param").id]);
  return c.json({ ok: true } as never);
});

// ── Agents (for the settings screen) ─────────────────────────────────

export default app;
