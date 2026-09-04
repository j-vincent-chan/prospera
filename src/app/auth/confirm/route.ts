import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Lands server-generated sign-in links (password reset, invitation, magic
 * link). A GET never verifies anything: mail scanners (Proofpoint, Exchange
 * Safe Links) open every link before the recipient does and would consume the
 * single-use token. GET hands off to /auth/continue, whose button POSTs back
 * here; only the POST verifies the token hash, sets the session cookie and
 * continues to `next`.
 */
const TYPES = new Set(["recovery", "invite", "magiclink", "email", "signup", "email_change"]);

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));
  if (!tokenHash || !type || !TYPES.has(type)) return NextResponse.redirect(`${origin}/login?error=expired`);
  const to = new URL(`${origin}/auth/continue`);
  to.searchParams.set("token_hash", tokenHash);
  to.searchParams.set("type", type);
  to.searchParams.set("next", next);
  return NextResponse.redirect(to, 303);
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "");
  const next = safeNext(form.get("next") ? String(form.get("next")) : null);
  if (tokenHash && TYPES.has(type)) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
            } catch {
              /* ignore */
            }
          },
        },
      },
    );
    const { data, error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    if (!error) {
      const pending = type === "invite" || Boolean(data.user?.user_metadata?.password_pending);
      if (pending) return NextResponse.redirect(`${origin}/set-password?next=${encodeURIComponent(next)}`, 303);
      return NextResponse.redirect(`${origin}${next}`, 303);
    }
  }
  const login = new URL(`${origin}/login`);
  login.searchParams.set("error", "expired");
  if (next !== "/home") login.searchParams.set("next", next);
  return NextResponse.redirect(login, 303);
}
