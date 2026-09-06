/**
 * Item-profile cache (plan § PR 1.3 schema; CLAUDE.md "cache anything
 * expensive by content hash"). Keyed by `contentHash(taxonomy_version +
 * kind + text)` — see `itemCacheKey` in ./index.ts — so an item is
 * classified by the model once per taxonomy version, exactly as embeddings
 * are cached today.
 *
 * Two implementations: in memory for tests and scripts (never writes), and
 * `fit_item_profiles` on Supabase for cron and backfills
 * (supabase/migrations/20260914110000_fit_item_profiles.sql). The Supabase
 * one is exercised by PR 1.4's profile builder, not here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuleClassification } from "@/lib/fit/classify/contracts";
import type { LlmClassification } from "@/lib/fit/classify/llm";
import type { ItemProfile } from "@/lib/fit/types";

/** One row of `fit_item_profiles`. */
export type CachedItemProfile = {
  content_hash: string;
  kind: string;
  /** The item id the row was first written for (PMID, project number, NCT id …); informational — the key is the hash. */
  ref_id: string | null;
  taxonomy_version: string;
  rules: RuleClassification | null;
  /** Null when the model was not needed for this item. */
  llm: LlmClassification | null;
  merged: ItemProfile;
  llm_model: string | null;
  /** ISO timestamp. */
  created_at: string;
};

export type ItemProfileCache = {
  get(contentHash: string): Promise<CachedItemProfile | null>;
  set(row: CachedItemProfile): Promise<void>;
};

/** Map-backed cache for tests and dry runs. `rows` is exposed for assertions. */
export class InMemoryItemProfileCache implements ItemProfileCache {
  readonly rows = new Map<string, CachedItemProfile>();
  reads = 0;
  writes = 0;

  async get(contentHash: string): Promise<CachedItemProfile | null> {
    this.reads += 1;
    return this.rows.get(contentHash) ?? null;
  }

  async set(row: CachedItemProfile): Promise<void> {
    this.writes += 1;
    this.rows.set(row.content_hash, row);
  }
}

const COLUMNS = "content_hash, kind, ref_id, taxonomy_version, rules, llm, merged, llm_model, created_at";

/**
 * `fit_item_profiles`-backed cache. Reads are `maybeSingle` by primary key;
 * writes upsert on `content_hash` so a concurrent classification of the same
 * text is harmless. Errors propagate — a cache that fails must not look like
 * a miss and silently re-bill the model on every run.
 */
export function supabaseItemProfileCache(db: SupabaseClient): ItemProfileCache {
  return {
    async get(contentHash) {
      const { data, error } = await db.from("fit_item_profiles").select(COLUMNS).eq("content_hash", contentHash).maybeSingle();
      if (error) throw new Error(`fit_item_profiles read failed: ${error.message}`);
      return (data as CachedItemProfile | null) ?? null;
    },
    async set(row) {
      const { error } = await db.from("fit_item_profiles").upsert(row, { onConflict: "content_hash" });
      if (error) throw new Error(`fit_item_profiles write failed: ${error.message}`);
    },
  };
}
