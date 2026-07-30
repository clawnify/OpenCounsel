// CSV export of a review grid.
//
// The export is the artefact that leaves the app — it goes into a data room, an
// email to a client, a bundle. So it carries the citation with the answer: a
// value column and, beside it, the page and the quote it came from. An export
// that dropped the evidence would launder a checked answer back into an
// unchecked one the moment it left the building.

export interface ExportColumn {
  id: string;
  key: string;
  question: string;
}

export interface ExportDocument {
  id: string;
  name: string;
}

export interface ExportCell {
  document_id: string;
  column_id: string;
  value: string;
  quote: string;
  page_no: number | null;
  status: string;
}

/** RFC 4180: quote every field, double any embedded quote. */
export function csvField(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * One row per document; three columns per review column (answer, page, quote).
 *
 * Unresolved cells render as an explicit marker rather than an empty string, so
 * "nobody answered this" and "the answer is blank" can't be confused by whoever
 * opens the spreadsheet.
 */
export function toCsv(
  documents: ExportDocument[],
  columns: ExportColumn[],
  cells: ExportCell[],
): string {
  const byDoc = new Map<string, Map<string, ExportCell>>();
  for (const cell of cells) {
    let row = byDoc.get(cell.document_id);
    if (!row) byDoc.set(cell.document_id, (row = new Map()));
    row.set(cell.column_id, cell);
  }

  const header = [
    "Document",
    ...columns.flatMap((c) => [c.question, `${c.question} — page`, `${c.question} — quote`]),
  ];

  const rows = documents.map((doc) => {
    const row = byDoc.get(doc.id);
    return [
      csvField(doc.name),
      ...columns.flatMap((col) => {
        const cell = row?.get(col.id);
        if (!cell) return [csvField("— not reviewed"), csvField(""), csvField("")];
        if (cell.status === "not_found") return [csvField("— not addressed"), csvField(""), csvField("")];
        if (cell.status !== "answered") return [csvField("— unresolved"), csvField(""), csvField("")];
        return [csvField(cell.value), csvField(cell.page_no ?? ""), csvField(cell.quote)];
      }),
    ].join(",");
  });

  return [header.map(csvField).join(","), ...rows].join("\r\n");
}
