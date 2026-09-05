/**
 * Streaming parser for the NLM MeSH descriptor file (desc<year>.xml, ~310 MB;
 * the .gz is ~17 MB). Pure: consumes text chunks and yields one record per
 * `<DescriptorRecord>`. The loader script wires it to fetch + gunzip; tests
 * feed it strings.
 */
import { decodeXmlEntities } from "@/lib/community/pubmed-author-match";

export type MeshDescriptorFileRecord = {
  ui: string;
  name: string;
  treeNumbers: string[];
  /** NLM DescriptorClass: 1 topical, 2 publication type, 3 check tag (Male / Female only), 4 geographic. */
  descriptorClass: number;
};

/**
 * MeSH check tags (plan PR 0.2: "a small explicit list"). NLM's DescriptorClass
 * marks only Male and Female as class 3 in the 2026 file — Humans, Animals and
 * the species are class 1 — so the file cannot supply this. Names; the loader
 * resolves them and fails if one is missing from the vocabulary.
 */
export const MESH_CHECK_TAG_NAMES = [
  "Humans",
  "Animals",
  "Male",
  "Female",
  "Infant, Newborn",
  "Infant",
  "Child, Preschool",
  "Child",
  "Adolescent",
  "Young Adult",
  "Adult",
  "Middle Aged",
  "Aged",
  "Aged, 80 and over",
  "Pregnancy",
  "Cats",
  "Cattle",
  "Chick Embryo",
  "Cricetinae",
  "Dogs",
  "Guinea Pigs",
  "Mice",
  "Rabbits",
  "Rats",
  "Sheep",
  "Swine",
] as const;

const OPEN = "<DescriptorRecord ";
const CLOSE = "</DescriptorRecord>";

export function parseDescriptorRecord(record: string): MeshDescriptorFileRecord | null {
  const ui = record.match(/<DescriptorUI>(D\d+)<\/DescriptorUI>/)?.[1];
  const rawName = record.match(/<DescriptorName>\s*<String>([\s\S]*?)<\/String>/)?.[1];
  if (!ui || !rawName) return null;
  const treeList = record.match(/<TreeNumberList>([\s\S]*?)<\/TreeNumberList>/)?.[1] ?? "";
  const treeNumbers = Array.from(treeList.matchAll(/<TreeNumber>([^<]+)<\/TreeNumber>/g), (m) => m[1]!.trim());
  const cls = Number(record.match(/^<DescriptorRecord[^>]*\bDescriptorClass\s*=\s*"(\d)"/)?.[1] ?? "1");
  return { ui, name: decodeXmlEntities(rawName).replace(/\s+/g, " ").trim(), treeNumbers, descriptorClass: cls };
}

/** Yield every `<DescriptorRecord>` in a chunked text stream; tags may straddle chunk boundaries. */
export async function* parseMeshDescriptorRecords(
  chunks: AsyncIterable<string> | Iterable<string>
): AsyncGenerator<MeshDescriptorFileRecord> {
  let buf = "";
  for await (const chunk of chunks) {
    buf += chunk;
    for (;;) {
      const start = buf.indexOf(OPEN);
      if (start < 0) {
        // Keep a tail so an opening tag split across chunks is still found.
        buf = buf.slice(-OPEN.length);
        break;
      }
      const end = buf.indexOf(CLOSE, start);
      if (end < 0) {
        buf = buf.slice(start);
        break;
      }
      const record = parseDescriptorRecord(buf.slice(start, end + CLOSE.length));
      buf = buf.slice(end + CLOSE.length);
      if (record) yield record;
    }
  }
}
