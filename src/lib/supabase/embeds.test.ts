/**
 * A guard for a bug class the 2026-09-13 audit found in five places: a
 * PostgREST embed of `profiles` from a table that has **two** foreign keys to
 * it (`team_memberships`: user_id and invited_by; `team_access_requests`:
 * user_id and resolved_by). PostgREST refuses the unhinted embed with "more
 * than one relationship was found", the callers ignored the error, and the
 * page read as if the team had no members — the workspace's owner select
 * offered only "Unassigned", @mentions never resolved, immediate
 * notifications reached nobody, access requests never surfaced.
 *
 * The fix is the hint: `profiles!user_id(...)`. This test reads the source
 * tree so the unhinted form cannot come back. The same rule covers the
 * nested `investigators(... pipeline_communities(...))` embed, which
 * `investigators` refuses for the same reason (two relationships).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/** Tables with two foreign keys to `profiles`, whose embeds must be hinted. */
const TWO_FKS_TO_PROFILES = ["team_memberships", "team_access_requests", "team_invitations", "team_former_members"];

describe("Supabase embeds that PostgREST would refuse", () => {
  const files = sourceFiles(ROOT);
  it("sees the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("never embeds profiles from a table with two foreign keys to it without a hint", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const table of TWO_FKS_TO_PROFILES) {
        // `.from("<table>")` … `.select("… profiles(` on the same statement, with no `!` hint.
        const re = new RegExp(`from\\("${table}"\\)[^;]*?select\\("([^"]*)"\\)`, "g");
        for (const m of src.matchAll(re)) {
          const select = m[1]!;
          if (/(^|[\s,])profiles\(/.test(select)) offenders.push(`${f.replace(ROOT, "src")}: ${select.slice(0, 80)}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("never nests pipeline_communities inside an investigators embed", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/investigators\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
        if (/pipeline_communities\(/.test(m[1]!)) offenders.push(`${f.replace(ROOT, "src")}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
