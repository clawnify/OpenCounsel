import { describe, it, expect } from "vitest";
import { PACKS, catalogue, findPack } from "./packs.js";

const ALLOWED_TYPES = new Set(["text", "enum", "date", "money", "percentage", "bulleted_list", "boolean"]);

describe("bundled workflow packs", () => {
  it("ships the library", () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(11);
    expect(findPack("nda-tabular-review")?.columns.length).toBe(9);
    expect(findPack("nope")).toBeUndefined();
  });

  it("only uses column types the app can store and render", () => {
    // The refresh script maps upstream `format` totally, so an unmapped format
    // fails there. This is the second gate, for a hand-edited artifact.
    for (const pack of PACKS) {
      for (const col of pack.columns) {
        expect(ALLOWED_TYPES, `${pack.id}/${col.key}`).toContain(col.type);
      }
    }
  });

  it("gives every column a stable, unique key", () => {
    for (const pack of PACKS) {
      const keys = pack.columns.map((c) => c.key);
      expect(new Set(keys).size, `${pack.id} has duplicate keys`).toBe(keys.length);
      for (const key of keys) expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("carries the instruction, not just the label", () => {
    // The upstream `prompt` is the whole value of these packs; if it stopped
    // arriving in `hint` the agent would be answering two-word questions.
    for (const pack of PACKS) {
      for (const col of pack.columns) {
        expect(col.question.length, `${pack.id}/${col.key}`).toBeGreaterThan(0);
        expect(col.hint.length, `${pack.id}/${col.key} lost its prompt`).toBeGreaterThan(40);
      }
    }
  });

  it("preserves attribution on every pack", () => {
    for (const pack of PACKS) {
      expect(pack.provenance.license).toBe("MIT");
      expect(pack.provenance.author).toBeTruthy();
      expect(pack.provenance.source_url).toContain("github.com");
      expect(pack.provenance.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("keeps the catalogue free of column bodies", () => {
    // 166 extraction prompts would be dumped into an agent's context by a
    // single list call; the catalogue is deliberately a shape, not the content.
    const listed = catalogue();
    expect(listed.length).toBe(PACKS.length);
    expect(JSON.stringify(listed)).not.toContain("Confidential Information' defined");
    expect(listed[0]).toHaveProperty("column_count");
  });
});
