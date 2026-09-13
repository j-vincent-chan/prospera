"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { revalidateDirectory } from "@/lib/investigators/cached-directory";

function maybeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

/** Postgres upsert fails if the same primary key appears twice in one batch. */
function dedupeSignalImportItems(items: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const id = maybeText((raw as SignalSourceItemImportRow).id);
    if (!id) continue;
    byId.set(id, raw);
  }
  return Array.from(byId.values());
}

function dedupeEntityLinks(links: unknown[]): unknown[] {
  const byKey = new Map<string, unknown>();
  for (const raw of links) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as SignalSourceItemEntityLinkRow;
    const sourceItemId = maybeText(r.source_item_id);
    const entityId = maybeText(r.tracked_entity_id);
    if (!sourceItemId || !entityId) continue;
    byKey.set(`${sourceItemId}:${entityId}`, raw);
  }
  return Array.from(byKey.values());
}

export type SignalSourceItemImportRow = {
  id?: string | null;
  community_id?: string | null;
  title?: string | null;
  category?: string | null;
  source_type?: string | null;
  status?: string | null;
  published_at?: string | null;
  found_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  source_url?: string | null;
  source_domain?: string | null;
  signal_group_key?: string | null;
  raw_text?: string | null;
  raw_summary?: string | null;
  nih_project_num?: string | null;
  tracked_entity_id?: string | null;
};

export type SignalSourceItemEntityLinkRow = {
  source_item_id?: string | null;
  tracked_entity_id?: string | null;
  created_at?: string | null;
};

/**
 * Upsert Signal `source_items` (+ optional entity links) into Prospera for the Community dashboard.
 */
export async function importSignalSourceItemsFromSignal(
  items: unknown[],
  entityLinks: unknown[] = []
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };
  if (!Array.isArray(items)) return { error: "Invalid source item payload" };
  if (items.length > 150) return { error: "Too many items in one batch (max 150)." };
  if (Array.isArray(entityLinks) && entityLinks.length > 500) {
    return { error: "Too many entity links in one batch (max 500)." };
  }

  const errors: string[] = [];
  let imported = 0;
  let linksImported = 0;

  const uniqueItems = dedupeSignalImportItems(items);
  const uniqueLinks = dedupeEntityLinks(entityLinks);

  const batchSize = 200;
  for (let offset = 0; offset < uniqueItems.length; offset += batchSize) {
    const slice = uniqueItems.slice(offset, offset + batchSize);
    const rows = slice
      .map((raw, i) => {
        if (!raw || typeof raw !== "object") {
          errors.push(`Item ${offset + i + 1}: invalid payload`);
          return null;
        }
        const r = raw as SignalSourceItemImportRow;
        const id = maybeText(r.id);
        if (!id) {
          errors.push(`Item ${offset + i + 1}: missing id`);
          return null;
        }
        return {
          id,
          origin: "signal",
          signal_community_id: maybeText(r.community_id),
          title: maybeText(r.title) ?? "",
          category: maybeText(r.category),
          source_type: maybeText(r.source_type),
          status: maybeText(r.status),
          published_at: maybeText(r.published_at),
          found_at: maybeText(r.found_at),
          source_url: maybeText(r.source_url),
          source_domain: maybeText(r.source_domain),
          signal_group_key: maybeText(r.signal_group_key),
          raw_summary: maybeText(r.raw_summary),
          nih_project_num: maybeText(r.nih_project_num),
          signal_tracked_entity_id: maybeText(r.tracked_entity_id),
          signal_created_at: maybeText(r.created_at),
          signal_updated_at: maybeText(r.updated_at),
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    if (rows.length === 0) continue;

    const { error } = await supabase.from("community_source_items").upsert(rows, { onConflict: "id" });
    if (error) {
      errors.push(`Batch ${Math.floor(offset / batchSize) + 1}: ${error.message}`);
      continue;
    }
    imported += rows.length;
  }

  if (uniqueLinks.length > 0) {
    const linkRows = uniqueLinks
      .map((raw, i) => {
        if (!raw || typeof raw !== "object") {
          errors.push(`Link ${i + 1}: invalid payload`);
          return null;
        }
        const r = raw as SignalSourceItemEntityLinkRow;
        const sourceItemId = maybeText(r.source_item_id);
        const entityId = maybeText(r.tracked_entity_id);
        if (!sourceItemId || !entityId) return null;
        return {
          source_item_id: sourceItemId,
          signal_entity_id: entityId,
          signal_link_created_at: maybeText(r.created_at),
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    for (let offset = 0; offset < linkRows.length; offset += batchSize) {
      const slice = linkRows.slice(offset, offset + batchSize);
      const { error } = await supabase
        .from("community_source_item_entities")
        .upsert(slice, { onConflict: "source_item_id,signal_entity_id" });
      if (error) {
        errors.push(`Entity links batch ${Math.floor(offset / batchSize) + 1}: ${error.message}`);
      } else {
        linksImported += slice.length;
      }
    }
  }

  revalidatePath("/portfolio-intelligence");
  revalidatePath("/portfolio-intelligence/data-sources");
  revalidatePath("/investigators");
  revalidateDirectory();

  if (uniqueItems.length > 0 && imported === 0) {
    const detail = errors[0] ?? "Upsert returned no rows.";
    return { error: `No signals were saved. ${detail}` };
  }

  return { ok: true as const, imported, linksImported, errors };
}
