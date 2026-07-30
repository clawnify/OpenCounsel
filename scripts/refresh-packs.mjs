// Vendor the tabular review column sets from Open Legal Products' MIT-licensed
// workflow repository into a portable JSON artifact.
//
// Why vendored rather than fetched at runtime: a firm's review criteria must not
// change because someone upstream edited a file. The packs are pinned to a
// commit, converted here, and imported into a deployment as *copies* — so a
// refresh never silently rewrites what a matter was already reviewed against.
//
// Run: node scripts/refresh-packs.mjs [--ref <sha>]
//
// Provenance is recorded per pack as required by the upstream repository's
// PROVENANCE.md (source URL, repo, revision, upstream path, author, license).

import { writeFile } from "node:fs/promises";
import { parse } from "yaml";

const REPO = "Open-Legal-Products/mike-workflows";
/** Pinned by default so a rebuild is reproducible; override with --ref. */
const DEFAULT_REF = "f5f9acedc9d851351cf6635f02bc3f9a7cc5d010";

const PACKS = [
  "nda-tabular-review",
  "credit-agreement-tabular-review",
  "commercial-lease-tabular-review",
  "spa-tabular-review",
  "shareholder-agreement-tabular-review",
  "limited-partnership-agreement-tabular-review",
  "employment-agreement-tabular-review",
  "supply-agreement-tabular-review",
  "commercial-agreement-tabular-review",
  "change-of-control-tabular-review",
  "e-discovery-tabular-review",
];

/**
 * Upstream `format` → our column `type`.
 *
 * `tag` maps to `enum` for completeness; no current pack uses it. `yes_no`
 * likewise. The mapping is total so an upstream addition fails loudly here
 * rather than silently importing as free text.
 */
const FORMAT_TO_TYPE = {
  text: "text",
  date: "date",
  monetary_amount: "money",
  percentage: "percentage",
  bulleted_list: "bulleted_list",
  yes_no: "boolean",
  tag: "enum",
};

const ref = process.argv.includes("--ref")
  ? process.argv[process.argv.indexOf("--ref") + 1]
  : DEFAULT_REF;

const raw = (path) => `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;

async function fetchText(path) {
  const res = await fetch(raw(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

/** Frontmatter only — we deliberately do not carry the upstream instruction body (see below). */
function frontmatter(skillMd) {
  const match = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("SKILL.md has no frontmatter");
  return parse(match[1]);
}

/** A question becomes a stable key the agent writes answers against. */
function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .split("_")
      .slice(0, 5)
      .join("_") || "column"
  );
}

const packs = [];

for (const dir of PACKS) {
  const base = `tabular-review-workflows/${dir}`;
  const [skillMd, columnsYaml] = await Promise.all([
    fetchText(`${base}/SKILL.md`),
    fetchText(`${base}/table-columns.yaml`),
  ]);

  const meta = frontmatter(skillMd);
  const { columns } = parse(columnsYaml);

  const seen = new Map();
  const mapped = columns
    .sort((a, b) => a.index - b.index)
    .map((col) => {
      const type = FORMAT_TO_TYPE[col.format];
      if (!type) throw new Error(`${dir}: unmapped format "${col.format}"`);

      const slug = slugify(col.name);
      const n = (seen.get(slug) ?? 0) + 1;
      seen.set(slug, n);

      return {
        key: n === 1 ? slug : `${slug}_${n}`,
        // The short name is the grid header; the upstream prompt is the real
        // instruction and reaches the agent as the column's hint.
        question: col.name,
        hint: col.prompt,
        type,
        options: col.tags ? col.tags.join(",") : "",
      };
    });

  // The upstream description points at "table-columns.yaml" — a file in their
  // repository, meaningless to someone reading this app. Their own goal is
  // harness-neutral workflows, so neutralising the reference is in that spirit.
  const description = meta.description.replace(
    /\s*(?:into )?the tabular review columns defined in [`']?table-columns\.yaml[`']?/i,
    " into this review's columns",
  );

  packs.push({
    id: dir,
    name: meta.metadata?.["mike-display-name"] ?? meta.name,
    description,
    practice: meta.metadata?.practice ?? "",
    jurisdictions: meta.metadata?.jurisdictions ?? "",
    columns: mapped,
    provenance: {
      source_url: `https://github.com/${REPO}/tree/${ref}/${base}`,
      repository: `https://github.com/${REPO}`,
      revision: ref,
      upstream_path: base,
      author: meta.metadata?.author ?? "Open Legal Products",
      license: meta.license ?? "MIT",
      // Modification notice, required when adapting third-party material.
      modifications:
        "Column definitions converted from table-columns.yaml to this app's column schema (format→type, name→question, prompt→hint, derived stable keys). The upstream SKILL.md instruction body is not carried: it directs the model to self-police citations and export .xlsx, whereas this app verifies every citation server-side and renders results in its own grid.",
    },
  });
}

const artifact = {
  generated_from: { repository: `https://github.com/${REPO}`, revision: ref },
  packs,
};

await writeFile(
  new URL("../src/server/packs.gen.json", import.meta.url),
  `${JSON.stringify(artifact, null, 2)}\n`,
);

const columnCount = packs.reduce((n, p) => n + p.columns.length, 0);
console.log(`✓ ${packs.length} packs, ${columnCount} columns → src/server/packs.gen.json (ref ${ref.slice(0, 8)})`);
