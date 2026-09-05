/**
 * Fit engine · PR 0.2 · load the NLM MeSH descriptor vocabulary (DECISIONS D10)
 * and validate src/lib/fit/signal-mapping.json against it.
 *
 *   npm run fit:load-mesh-descriptors                          # download desc<year>.gz, load mesh_descriptors, validate
 *   npm run fit:load-mesh-descriptors -- --year 2026           # edition (default: the current year)
 *   npm run fit:load-mesh-descriptors -- --file desc2026.gz    # a local copy (.gz or .xml) instead of downloading
 *   npm run fit:load-mesh-descriptors -- --dry-run             # parse + validate; write nothing
 *   npm run fit:load-mesh-descriptors -- --validate-only       # no download: validate against the table as loaded
 *   npm run fit:load-mesh-descriptors -- --dry-run --write-fixture src/lib/fit/__fixtures__/mesh-descriptors-subset.json
 *
 * Exits 1 when any MeSH name, check tag, publication type or tree prefix in
 * signal-mapping.json does not resolve — a rule keyed on a bad name would
 * otherwise never fire, silently. The table is still loaded first so the
 * vocabulary is right even while the mapping is being fixed.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createReadStream, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import signalMapping from "../src/lib/fit/signal-mapping.json";
import {
  MESH_CHECK_TAG_NAMES,
  parseMeshDescriptorRecords,
  type MeshDescriptorFileRecord,
} from "../src/lib/fit/classify/mesh-descriptor-file";
import {
  buildMeshIndex,
  formatSignalMappingValidation,
  validateSignalMapping,
  type MeshDescriptorRow,
} from "../src/lib/fit/classify/mesh";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const VALIDATE_ONLY = flag("--validate-only");
const YEAR = Number(opt("--year") ?? new Date().getFullYear());
const FILE = opt("--file");
const FIXTURE_OUT = opt("--write-fixture");
const UPSERT_CHUNK = 500;

/** Descriptors the mesh.ts unit tests need beyond the mapping's own names (triangle vertices, tree checks). */
const FIXTURE_EXTRA_NAMES = [
  "Adult",
  "Archaea",
  "Escherichia coli",
  "HIV-1",
  "HeLa Cells",
  "Cell Physiological Phenomena",
  "Molecular Structure",
  "Male",
  "Female",
];

function descriptorUrl(year: number): string {
  return `https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc${year}.gz`;
}

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Text chunks from a local .xml / .gz or the NLM download. */
async function* sourceChunks(): AsyncGenerator<string> {
  if (FILE) {
    const raw = createReadStream(FILE);
    const stream = FILE.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
    stream.setEncoding("utf8");
    for await (const chunk of stream) yield chunk as string;
    return;
  }
  const url = descriptorUrl(YEAR);
  console.error(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`NLM download failed (${res.status}) for ${url}`);
  const gunzip = createGunzip();
  gunzip.setEncoding("utf8");
  Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(gunzip);
  for await (const chunk of gunzip) yield chunk as string;
}

function toRow(rec: MeshDescriptorFileRecord, checkTags: Set<string>): MeshDescriptorRow & { year: number } {
  return { ui: rec.ui, name: rec.name, tree_numbers: rec.treeNumbers, is_check_tag: checkTags.has(rec.name), year: YEAR };
}

async function loadFromTable(client: SupabaseClient): Promise<MeshDescriptorRow[]> {
  const rows: MeshDescriptorRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("mesh_descriptors")
      .select("ui, name, tree_numbers, is_check_tag")
      .order("ui")
      .range(from, from + 999);
    if (error) throw new Error(`mesh_descriptors read failed: ${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as MeshDescriptorRow[]));
    if (data.length < 1000) break;
  }
  return rows;
}

function mappingNames(): Set<string> {
  const names = new Set<string>();
  const MESH_KEYS = new Set(["mesh", "mesh_any", "mesh_all", "mesh_any_2", "mesh_major", "mesh_major_any"]);
  const visit = (src: Record<string, unknown> | undefined) => {
    if (!src) return;
    for (const [key, raw] of Object.entries(src)) {
      if (key === "not") {
        visit(raw as Record<string, unknown>);
        continue;
      }
      if (!(MESH_KEYS.has(key) || key.startsWith("check_tag") || key.startsWith("pubtype"))) continue;
      for (const v of Array.isArray(raw) ? raw : [raw]) if (typeof v === "string") names.add(v);
    }
  };
  for (const rule of signalMapping.rules as Array<{ when?: Record<string, unknown>; not?: Record<string, unknown> }>) {
    visit(rule.when);
    visit(rule.not);
  }
  return names;
}

async function main(): Promise<void> {
  const checkTags = new Set<string>(MESH_CHECK_TAG_NAMES);
  let rows: Array<MeshDescriptorRow & { year?: number }>;

  if (VALIDATE_ONLY) {
    rows = await loadFromTable(db());
    console.error(`mesh_descriptors: ${rows.length} rows in the table`);
  } else {
    rows = [];
    const classCounts: Record<string, number> = {};
    for await (const rec of parseMeshDescriptorRecords(sourceChunks())) {
      rows.push(toRow(rec, checkTags));
      classCounts[rec.descriptorClass] = (classCounts[rec.descriptorClass] ?? 0) + 1;
    }
    console.error(`parsed ${rows.length} descriptors for ${YEAR} (DescriptorClass counts ${JSON.stringify(classCounts)})`);
    if (rows.length < 25_000) throw new Error(`only ${rows.length} descriptors parsed — the file looks truncated`);
  }

  const index = buildMeshIndex(rows);

  // The check-tag list is ours; a name that no longer exists would silently un-flag it.
  const missingTags = MESH_CHECK_TAG_NAMES.filter((n) => !index.byName.has(n));
  if (missingTags.length) {
    console.error(`check-tag names missing from the vocabulary: ${missingTags.join(", ")}`);
    process.exit(1);
  }

  if (FIXTURE_OUT) {
    const wanted = new Set<string>([...mappingNames(), ...MESH_CHECK_TAG_NAMES, ...FIXTURE_EXTRA_NAMES]);
    const subset = rows
      .filter((r) => wanted.has(r.name))
      .map(({ ui, name, tree_numbers, is_check_tag }) => ({ ui, name, tree_numbers, is_check_tag }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const missing = [...wanted].filter((n) => !index.byName.has(n));
    writeFileSync(
      FIXTURE_OUT,
      JSON.stringify({ _source: `NLM desc${YEAR}, subset written by scripts/fit-load-mesh-descriptors.ts --write-fixture`, year: YEAR, descriptors: subset }, null, 2) + "\n"
    );
    console.error(`fixture: ${subset.length} descriptors → ${FIXTURE_OUT}${missing.length ? ` (not in vocabulary: ${missing.join(", ")})` : ""}`);
  }

  if (!DRY_RUN && !VALIDATE_ONLY) {
    const client = db();
    let written = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await client.from("mesh_descriptors").upsert(chunk, { onConflict: "ui" });
      if (error) throw new Error(`mesh_descriptors upsert failed at ${i}: ${error.message}`);
      written += chunk.length;
      if (written % 5000 === 0 || written === rows.length) console.error(`  upserted ${written}/${rows.length}`);
    }
  }

  const validation = validateSignalMapping(index);
  console.log(formatSignalMappingValidation(validation));
  if (!validation.ok) {
    console.error(`\nFAILED: ${validation.unmatched.length} value(s) in signal-mapping.json do not resolve against MeSH ${YEAR}.`);
    process.exit(1);
  }
  console.error(DRY_RUN ? "\ndry run: nothing written" : VALIDATE_ONLY ? "\nvalidated against the table" : `\nloaded ${rows.length} descriptors`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
