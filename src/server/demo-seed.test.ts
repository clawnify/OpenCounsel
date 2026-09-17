import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { verifyQuote } from "./citations.js";
import schema from "./schema.sql?raw";
import seed from "../../demo/seed.sql?raw";

function seededDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schema);
  db.exec(seed);
  return db;
}

describe("demo seed", () => {
  it("loads on the schema with intact references", () => {
    const db = seededDatabase();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM matters").get()).toEqual({ n: 2 });
  });

  it("stores the verdicts the citation check would reach", () => {
    const db = seededDatabase();
    const cells = db
      .prepare("SELECT document_id, quote, page_no, status FROM review_cells WHERE status != 'not_found'")
      .all() as { document_id: string; quote: string; page_no: number; status: string }[];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const pages = db
        .prepare("SELECT page_no, text FROM document_pages WHERE document_id = ? ORDER BY page_no")
        .all(cell.document_id) as { page_no: number; text: string }[];
      expect(verifyQuote(cell.quote, cell.page_no, pages).ok, cell.quote).toBe(cell.status === "answered");
    }
  });

  it("leaves no review looking as if an agent were still working", () => {
    const db = seededDatabase();
    expect(db.prepare("SELECT count(*) AS n FROM reviews WHERE status = 'running'").get()).toEqual({ n: 0 });
  });
});
