// The bundled library of review column sets.
//
// These are not ours. They are practitioner-authored column definitions from
// Open Legal Products' MIT-licensed workflow repository, vendored by
// `scripts/refresh-packs.mjs` and pinned to a commit. Writing our own would
// have meant inventing legal review criteria we have no standing to invent;
// importing theirs is both leaner and better.
//
// A firm imports a pack, which *copies* it into their own workflows. From that
// moment it is theirs to edit, and refreshing the bundle cannot alter a review
// that has already been run.

import artifact from "./packs.gen.json";

export interface PackColumn {
  key: string;
  question: string;
  hint: string;
  type: string;
  options: string;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  practice: string;
  jurisdictions: string;
  columns: PackColumn[];
  provenance: {
    source_url: string;
    repository: string;
    revision: string;
    upstream_path: string;
    author: string;
    license: string;
    modifications: string;
  };
}

export const PACKS: Pack[] = artifact.packs;

export function findPack(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}

/**
 * The catalogue, without the columns.
 *
 * Every pack's full column set is several thousand words of extraction prompts;
 * an agent listing the library to choose one must not receive all 166 of them.
 * It gets the shape here and fetches a single pack's columns on demand.
 */
export function catalogue() {
  return PACKS.map(({ id, name, description, practice, jurisdictions, columns, provenance }) => ({
    id,
    name,
    description,
    practice,
    jurisdictions,
    column_count: columns.length,
    author: provenance.author,
    license: provenance.license,
    source_url: provenance.source_url,
  }));
}
