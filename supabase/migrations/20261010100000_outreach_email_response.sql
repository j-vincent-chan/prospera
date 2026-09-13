-- Outreach email (design handoff: Prospera Outreach Email).
--
-- Every sent message now carries two one-click links — "I’m interested" and
-- "Not this time" — that open /r/<token>. The token is minted per recipient
-- row as the message is sent and is the only credential the public page
-- accepts: it reaches exactly that row and, through it, the match the message
-- was sent for. The HTML as sent is kept beside the plain text already in
-- rendered_body, so the thread can show what the PI saw.
ALTER TABLE public.outreach_message_recipients
  ADD COLUMN IF NOT EXISTS response_token TEXT,
  ADD COLUMN IF NOT EXISTS response TEXT CHECK (response IN ('interested', 'pass')),
  ADD COLUMN IF NOT EXISTS response_note TEXT,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rendered_html TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_message_recipients_response_token_uniq
  ON public.outreach_message_recipients (response_token)
  WHERE response_token IS NOT NULL;

-- outreach_recipients.reply_source gains the value 'email_link' (free text, no CHECK to change);
-- 'manual' stays what recordReplyAction writes.
