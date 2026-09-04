/**
 * Retry PubMed refresh for specific investigators (e.g. after bulk 429 failures).
 *
 * Usage:
 *   npx tsx scripts/retry-pubmed-investigators.ts
 *   npx tsx scripts/retry-pubmed-investigators.ts <uuid> [<uuid> ...]
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { refreshPubmedSource } from "../src/lib/investigators/refresh-sources";
import { syncInvestigatorCommunitySignalsFromCaches } from "../src/lib/community/sync-community-signals-from-caches";

/** Last bulk slow-retry failures (2026-05-30). */
const DEFAULT_FAILED_IDS = [
  "0ec1e65f-ee29-4dc6-9ed0-914358c12ed7",
  "2dea1755-93f0-44d8-b1e4-949236d5db9c",
  "3064c65a-dbe8-41be-8d71-27adf5efda73",
  "4f0f46cd-5087-479e-b7e4-16271d1613b0",
  "574dee7a-dcf3-41e5-b75a-3fe9295e5ed9",
  "923c8aba-5700-4f74-b828-5a7c18b0950d",
  "a598f94b-e8f7-4bfd-ac98-5dda11b3731b",
  "f4dba756-b570-48ea-a2ba-1c500b6411e2",
];

const DELAY_BETWEEN_INVESTIGATORS_MS = Number(
  process.env.PUBMED_RETRY_DELAY_MS ?? 5000
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  loadEnv({ path: resolve(process.cwd(), ".env") });
  loadEnv({ path: resolve(process.cwd(), ".env.local") });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim() || !key?.trim()) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const ids =
    process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_FAILED_IDS;

  const supabase = createClient(url, key);
  let ok = 0;
  let failed = 0;
  const errors: { id: string; message: string }[] = [];

  console.log(`Retrying PubMed for ${ids.length} investigator(s), ${DELAY_BETWEEN_INVESTIGATORS_MS}ms between each…\n`);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const label = `${i + 1}/${ids.length} ${id.slice(0, 8)}…`;
    try {
      // refreshPubmedSource walks the identity ladder and records the matched
      // rung on investigator_sources (PR 0.1b); it never throws.
      const outcome = await refreshPubmedSource(supabase, id);
      if (!outcome.ok) throw new Error(outcome.message);
      await syncInvestigatorCommunitySignalsFromCaches(supabase, id);
      ok += 1;
      console.log(`OK ${label} — ${outcome.message}`);
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ id, message });
      console.error(`FAIL ${label} — ${message}`);
    }
    if (i < ids.length - 1) await sleep(DELAY_BETWEEN_INVESTIGATORS_MS);
  }

  console.log("\n---");
  console.log(`Done: ${ok} ok, ${failed} failed`);
  if (errors.length) {
    console.log(JSON.stringify({ errors }, null, 2));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
