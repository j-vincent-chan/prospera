import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildKeywordOrFilter } from "@/lib/funding-opportunities/keyword-filter";
import { postgrestQuotedString } from "@/lib/funding-opportunities/agency-filter";
import {
  fundingListRowScope,
  type FundingListRowBucket,
} from "@/lib/funding-opportunities/funding-list-row-scope";

const MODEL = "gpt-4o-mini";
const MAX_STEPS = 6;
const MAX_SEARCH_LIMIT = 40;
const DEFAULT_SEARCH_LIMIT = 15;
// Upper bound on rows pulled from Postgres before JS-side status filtering / slicing.
const DB_SCAN_CAP = 400;
const MAX_DESCRIPTION_CHARS = 1_600;
const MAX_SOURCES = 30;

const SEARCH_COLUMNS =
  "id, title, agency, agency_code, opportunity_number, status, forecasted, posted_date, close_date, funding_instrument, category, award_floor, award_ceiling";

export type FundingChatMessage = { role: "user" | "assistant"; content: string };

export type FundingChatSource = {
  id: string;
  title: string;
  agency: string | null;
  status: FundingListRowBucket;
  close_date: string | null;
  posted_date: string | null;
  funding_instrument: string | null;
};

export type FundingChatResult =
  | { ok: true; answer: string; sources: FundingChatSource[] }
  | { ok: false; error: string };

type OpportunityStatusFilter =
  | "open"
  | "forecasted"
  | "closed"
  | "open_or_forecasted"
  | "any";

type OpportunityFilters = {
  keyword?: string;
  agency?: string;
  nihInstitutes?: string[];
  nihRelevantOnly?: boolean;
  fundingInstrument?: string;
  status?: OpportunityStatusFilter;
  closingWithinDays?: number;
  postedWithinDays?: number;
  minAwardCeiling?: number;
  sortBy?: "close_date" | "posted_date" | "award_ceiling" | "title";
  limit?: number;
};

type SearchRow = {
  id: string;
  title: string;
  agency: string | null;
  agency_code: string | null;
  opportunity_number: string | null;
  status: string | null;
  forecasted: boolean | null;
  posted_date: string | null;
  close_date: string | null;
  funding_instrument: string | null;
  category: string | null;
  award_floor: number | null;
  award_ceiling: number | null;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function escapeIlikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function startOfToday(): Date {
  return new Date(new Date().toDateString());
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoDateOffset(days: number): string {
  const d = startOfToday();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function isMissingColumnError(message: string | undefined): boolean {
  if (!message) return false;
  return /nih_ic_tokens|activity_families|column .* does not exist|42703/i.test(message);
}

function statusMatches(bucket: FundingListRowBucket, status: OpportunityStatusFilter): boolean {
  if (status === "any") return true;
  if (status === "open_or_forecasted") return bucket === "open" || bucket === "forecasted";
  return bucket === status;
}

function normalizeIcTokens(tokens: string[] | undefined): string[] {
  if (!Array.isArray(tokens)) return [];
  return tokens
    .map((t) => String(t).replace(/[^A-Za-z0-9]/g, "").toUpperCase())
    .filter((t) => t.length > 0);
}

/**
 * Run a structured query against `funding_opportunities`. Date windows, award floor, agency,
 * instrument, and keyword are applied in Postgres; the open/forecasted/closed bucket is computed
 * in JS (it depends on close_date vs today) and filtered afterwards.
 */
async function runOpportunitySearch(
  supabase: SupabaseClient,
  filters: OpportunityFilters,
  scanCap = DB_SCAN_CAP
): Promise<{ rows: Array<SearchRow & { statusBucket: FundingListRowBucket }>; scannedAtCap: boolean }> {
  const status = filters.status ?? "open_or_forecasted";
  const icTokens = normalizeIcTokens(filters.nihInstitutes);
  const sortBy = filters.sortBy ?? "close_date";

  const buildQuery = (withIc: boolean) => {
    let q = supabase.from("funding_opportunities").select(SEARCH_COLUMNS).limit(scanCap);

    const kw = filters.keyword ? buildKeywordOrFilter(filters.keyword) : null;
    if (kw) q = q.or(kw);

    if (filters.nihRelevantOnly) {
      q = q.eq("is_nih_relevant", true);
    }

    if (filters.agency && filters.agency.trim()) {
      const pat = postgrestQuotedString(`%${escapeIlikePattern(filters.agency.trim())}%`);
      q = q.or(`agency.ilike.${pat},agency_code.ilike.${pat}`);
    }

    if (filters.fundingInstrument && filters.fundingInstrument.trim()) {
      const pat = postgrestQuotedString(`%${escapeIlikePattern(filters.fundingInstrument.trim())}%`);
      q = q.or(`funding_instrument.ilike.${pat}`);
    }

    if (typeof filters.minAwardCeiling === "number" && Number.isFinite(filters.minAwardCeiling)) {
      q = q.gte("award_ceiling", filters.minAwardCeiling);
    }

    if (typeof filters.postedWithinDays === "number" && filters.postedWithinDays > 0) {
      q = q.gte("posted_date", isoDateOffset(-filters.postedWithinDays));
    }

    if (typeof filters.closingWithinDays === "number" && filters.closingWithinDays > 0) {
      q = q.gte("close_date", isoDate(startOfToday())).lte("close_date", isoDateOffset(filters.closingWithinDays));
    }

    if (withIc && icTokens.length > 0) {
      q = q.overlaps("nih_ic_tokens", icTokens);
    }

    if (sortBy === "posted_date") q = q.order("posted_date", { ascending: false, nullsFirst: false });
    else if (sortBy === "award_ceiling") q = q.order("award_ceiling", { ascending: false, nullsFirst: false });
    else if (sortBy === "title") q = q.order("title", { ascending: true, nullsFirst: false });
    else q = q.order("close_date", { ascending: true, nullsFirst: false });

    return q;
  };

  let { data, error } = await buildQuery(icTokens.length > 0);
  if (error && icTokens.length > 0 && isMissingColumnError(error.message)) {
    ({ data, error } = await buildQuery(false));
  }
  if (error) throw new Error(error.message);

  const today = startOfToday();
  const scanned = (data ?? []) as SearchRow[];
  const withBucket = scanned
    .map((r) => ({
      ...r,
      statusBucket: fundingListRowScope(
        { status: r.status, close_date: r.close_date, forecasted: r.forecasted },
        today
      ),
    }))
    .filter((r) => statusMatches(r.statusBucket, status));

  return { rows: withBucket, scannedAtCap: scanned.length >= scanCap };
}

function toSource(row: SearchRow & { statusBucket: FundingListRowBucket }): FundingChatSource {
  return {
    id: row.id,
    title: row.title,
    agency: row.agency,
    status: row.statusBucket,
    close_date: row.close_date,
    posted_date: row.posted_date,
    funding_instrument: row.funding_instrument,
  };
}

function compactRow(row: SearchRow & { statusBucket: FundingListRowBucket }) {
  return {
    id: row.id,
    title: row.title,
    agency: row.agency,
    agency_code: row.agency_code,
    opportunity_number: row.opportunity_number,
    status: row.statusBucket,
    posted_date: row.posted_date,
    close_date: row.close_date,
    funding_instrument: row.funding_instrument,
    category: row.category,
    award_floor: row.award_floor,
    award_ceiling: row.award_ceiling,
  };
}

async function getOpportunityDetail(supabase: SupabaseClient, id: string) {
  const baseSelect = `${SEARCH_COLUMNS}, description, applicant_types`;
  const richSelect = `${baseSelect}, nih_ic_tokens, activity_families`;

  let res = await supabase.from("funding_opportunities").select(richSelect).eq("id", id).maybeSingle();
  if (res.error && isMissingColumnError(res.error.message)) {
    res = await supabase.from("funding_opportunities").select(baseSelect).eq("id", id).maybeSingle();
  }
  if (res.error) throw new Error(res.error.message);
  const row = res.data as
    | (SearchRow & {
        description: string | null;
        applicant_types: unknown;
        nih_ic_tokens?: string[] | null;
        activity_families?: string[] | null;
      })
    | null;
  if (!row) return null;

  const { data: feat } = await supabase
    .from("opportunity_features")
    .select(
      "parsed_summary, science_tags, disease_tags, method_tags, translational_tags, mechanism_type, human_subjects_relevance, clinical_relevance_score"
    )
    .eq("opportunity_id", id)
    .maybeSingle();

  const today = startOfToday();
  const description = row.description ? String(row.description).slice(0, MAX_DESCRIPTION_CHARS) : null;

  return {
    id: row.id,
    title: row.title,
    agency: row.agency,
    agency_code: row.agency_code,
    opportunity_number: row.opportunity_number,
    status: fundingListRowScope(
      { status: row.status, close_date: row.close_date, forecasted: row.forecasted },
      today
    ),
    posted_date: row.posted_date,
    close_date: row.close_date,
    funding_instrument: row.funding_instrument,
    category: row.category,
    award_floor: row.award_floor,
    award_ceiling: row.award_ceiling,
    applicant_types: row.applicant_types ?? null,
    nih_ic_tokens: row.nih_ic_tokens ?? null,
    activity_families: row.activity_families ?? null,
    description,
    description_truncated: Boolean(row.description && row.description.length > MAX_DESCRIPTION_CHARS),
    features: feat ?? null,
  };
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_opportunities",
      description:
        "Search stored federal funding notices (Simpler.Grants.gov, NIH-focused). Returns matching opportunities with id, title, agency, status, dates, instrument, and award bounds. Use this for any question about which opportunities exist, deadlines, agencies, or award sizes.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "Free-text terms matched against title, description, and opportunity number (e.g. 'immunotherapy', 'T cell exhaustion').",
          },
          agency: {
            type: "string",
            description: "Agency name or code substring, e.g. 'NIH', 'National Cancer Institute', 'NSF'.",
          },
          nihInstitutes: {
            type: "array",
            items: { type: "string" },
            description:
              "NIH institute/center abbreviations to require, e.g. ['NCI','NIAID','NHLBI']. Narrows to notices tagged with those ICs.",
          },
          nihRelevantOnly: {
            type: "boolean",
            description:
              "Set true when the user asks about NIH funding generally (without naming a specific institute). Restricts to NIH-relevant notices.",
          },
          fundingInstrument: {
            type: "string",
            description: "Funding instrument substring, e.g. 'grant', 'cooperative agreement'.",
          },
          status: {
            type: "string",
            enum: ["open", "forecasted", "closed", "open_or_forecasted", "any"],
            description: "Opportunity lifecycle filter. Defaults to open_or_forecasted (currently actionable).",
          },
          closingWithinDays: {
            type: "number",
            description: "Only notices whose close_date is between today and N days from now (deadline questions).",
          },
          postedWithinDays: {
            type: "number",
            description: "Only notices posted within the last N days (recently added).",
          },
          minAwardCeiling: {
            type: "number",
            description: "Minimum award ceiling in US dollars.",
          },
          sortBy: {
            type: "string",
            enum: ["close_date", "posted_date", "award_ceiling", "title"],
            description: "Sort order. Defaults to close_date (soonest deadline first).",
          },
          limit: {
            type: "number",
            description: `Max rows to return (1-${MAX_SEARCH_LIMIT}, default ${DEFAULT_SEARCH_LIMIT}).`,
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_opportunities",
      description:
        "Count how many stored opportunities match the given filters (same filters as search_opportunities). Use for 'how many…' questions instead of listing.",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          agency: { type: "string" },
          nihInstitutes: { type: "array", items: { type: "string" } },
          nihRelevantOnly: { type: "boolean" },
          fundingInstrument: { type: "string" },
          status: {
            type: "string",
            enum: ["open", "forecasted", "closed", "open_or_forecasted", "any"],
          },
          closingWithinDays: { type: "number" },
          postedWithinDays: { type: "number" },
          minAwardCeiling: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_opportunity",
      description:
        "Fetch the full detail for one opportunity by its id (description, eligibility, award bounds, tags). Use after search when the user wants specifics about a particular notice.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The opportunity id returned by search_opportunities." },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function argsToFilters(args: Record<string, unknown>): OpportunityFilters {
  const status = args.status as OpportunityStatusFilter | undefined;
  return {
    keyword: typeof args.keyword === "string" ? args.keyword : undefined,
    agency: typeof args.agency === "string" ? args.agency : undefined,
    nihInstitutes: Array.isArray(args.nihInstitutes)
      ? (args.nihInstitutes as unknown[]).map(String)
      : undefined,
    nihRelevantOnly: typeof args.nihRelevantOnly === "boolean" ? args.nihRelevantOnly : undefined,
    fundingInstrument: typeof args.fundingInstrument === "string" ? args.fundingInstrument : undefined,
    status:
      status && ["open", "forecasted", "closed", "open_or_forecasted", "any"].includes(status)
        ? status
        : undefined,
    closingWithinDays: typeof args.closingWithinDays === "number" ? args.closingWithinDays : undefined,
    postedWithinDays: typeof args.postedWithinDays === "number" ? args.postedWithinDays : undefined,
    minAwardCeiling: typeof args.minAwardCeiling === "number" ? args.minAwardCeiling : undefined,
    sortBy: args.sortBy as OpportunityFilters["sortBy"],
  };
}

async function executeTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  sourcesById: Map<string, FundingChatSource>
): Promise<unknown> {
  if (name === "search_opportunities") {
    const filters = argsToFilters(args);
    const limit = clampInt(args.limit, 1, MAX_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT);
    const { rows, scannedAtCap } = await runOpportunitySearch(supabase, filters);
    const sliced = rows.slice(0, limit);
    for (const r of sliced) {
      if (sourcesById.size < MAX_SOURCES && !sourcesById.has(r.id)) {
        sourcesById.set(r.id, toSource(r));
      }
    }
    return {
      total_matches: scannedAtCap ? `${rows.length}+ (scan capped at ${DB_SCAN_CAP})` : rows.length,
      returned: sliced.length,
      opportunities: sliced.map(compactRow),
    };
  }

  if (name === "count_opportunities") {
    const filters = argsToFilters(args);
    const { rows, scannedAtCap } = await runOpportunitySearch(supabase, filters);
    return {
      count: rows.length,
      capped: scannedAtCap,
      note: scannedAtCap ? `At least ${rows.length} (scan capped at ${DB_SCAN_CAP}).` : undefined,
    };
  }

  if (name === "get_opportunity") {
    const id = typeof args.id === "string" ? args.id : "";
    if (!id) return { error: "Missing opportunity id." };
    const detail = await getOpportunityDetail(supabase, id);
    if (!detail) return { error: "No opportunity found with that id." };
    if (sourcesById.size < MAX_SOURCES && !sourcesById.has(detail.id)) {
      sourcesById.set(detail.id, {
        id: detail.id,
        title: detail.title,
        agency: detail.agency,
        status: detail.status,
        close_date: detail.close_date,
        posted_date: detail.posted_date,
        funding_instrument: detail.funding_instrument,
      });
    }
    return detail;
  }

  return { error: `Unknown tool: ${name}` };
}

function systemPrompt(): string {
  const today = isoDate(startOfToday());
  return [
    "You are Prospera's funding-opportunities assistant for a research-development office.",
    `Today's date is ${today}.`,
    "",
    "You can ONLY answer using data returned by the provided tools (search_opportunities, count_opportunities, get_opportunity), which query a database of federal funding notices (Simpler.Grants.gov, NIH-focused).",
    "Rules:",
    "- Always call a tool to ground any claim about specific opportunities, counts, deadlines, agencies, or award amounts. Never invent opportunities, numbers, dates, or URLs.",
    "- Match the user's scope precisely. If they ask about NIH generally, set nihRelevantOnly=true. If they name specific NIH institutes (NCI, NIAID, NHLBI, …), pass those in nihInstitutes. If they name another agency (NSF, DOE, CDC, …), pass it as agency. Do not present non-matching agencies as if they matched.",
    "- If the tools return no matches, say so plainly and suggest how to broaden the search. Do not guess.",
    "- Refer to opportunities by their exact title. The UI shows a separate, clickable 'Sources' list for the opportunities you surfaced, so you do not need to write links yourself.",
    "- For deadline math, compare close_date to today's date. 'open' means currently accepting applications; 'forecasted' means announced but not yet open; 'closed' means past deadline or archived.",
    "- Note that some notices may have incomplete close dates or award amounts; when a field is missing, say it is not specified rather than assuming.",
    "- Be brief: at most three short sentences — what matched, how many, and the single strongest fit with its next due date. Never list every opportunity or repeat their fields; the results table under your answer shows them. No headings; bold only the strongest fit's title. Format dollar amounts and dates readably.",
    "- Stay on topic: funding opportunities in this database. Politely decline unrelated requests.",
  ].join("\n");
}

/** Run one assistant turn: tool-calling loop grounded in the funding database. */
export async function runFundingChat(
  supabase: SupabaseClient,
  history: FundingChatMessage[]
): Promise<FundingChatResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured." };

  const openai = new OpenAI({ apiKey });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const sourcesById = new Map<string, FundingChatSource>();

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 900,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      });

      const msg = completion.choices[0]?.message;
      if (!msg) return { ok: false, error: "Empty model response." };

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const answer = msg.content?.trim() ?? "";
        if (!answer) return { ok: false, error: "Empty model response." };
        return { ok: true, answer, sources: Array.from(sourcesById.values()) };
      }

      messages.push(msg);
      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        const args = parseArgs(call.function.arguments);
        let result: unknown;
        try {
          result = await executeTool(supabase, call.function.name, args, sourcesById);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
    return {
      ok: false,
      error: "The assistant needed too many steps. Try a more specific question.",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
