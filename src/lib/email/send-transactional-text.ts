/** Send a transactional email via Resend (same credentials as digest / notifications). Plain text always; HTML when provided. */

export async function sendTransactionalTextEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
  /** Inline images referenced from the HTML as cid:<content_id>. */
  attachments?: Array<{ filename: string; content: string; content_id: string }>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!key || !from) {
    return { ok: false, error: "RESEND_API_KEY or RESEND_FROM_EMAIL not configured." };
  }

  const to = input.to.trim();
  if (!to) return { ok: false, error: "Recipient email is empty." };

  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject: input.subject.trim().slice(0, 998),
    text: input.text,
  };
  if (input.html) payload.html = input.html;
  if (input.attachments?.length) payload.attachments = input.attachments;
  const rt = input.replyTo?.trim();
  if (rt) payload.reply_to = [rt];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Resend HTTP ${res.status}: ${text.slice(0, 400)}` };
  }
  return { ok: true };
}
