"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadResponseContext, recordResponse, TOKEN_RE } from "@/lib/outreach/response";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

/**
 * Public action behind the emailed response link. No Prospera session is
 * involved — like `biosketch-public-actions.ts`, the token is the credential
 * and it only ever reaches the one message-recipient row it was minted for.
 * A GET never writes (link scanners open URLs); this action runs when the
 * person presses Send on the page.
 */

type Result = { ok: true } | { ok: false; error: string };

const schema = z.object({
  token: z.string().regex(TOKEN_RE),
  response: z.enum(["interested", "pass"]),
  note: z.string().max(1000).nullable(),
});

export async function respondFromEmailAction(input: { token: string; response: "interested" | "pass"; note: string | null }): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This link is no longer valid." };
  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service unavailable." };
  const ctx = await loadResponseContext(admin, parsed.data.token);
  if (!ctx) return { ok: false, error: "This link is no longer valid." };
  const r = await recordResponse(admin, ctx, { response: parsed.data.response, note: parsed.data.note });
  if (!r.ok) return r;
  revalidatePath("/outreach");
  revalidatePath("/home");
  revalidatePath(`/outreach?item=${ctx.itemId}`);
  return { ok: true };
}
