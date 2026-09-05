export type SimplerPagination = {
  page_offset: number;
  page_size: number;
  sort_order: { order_by: string; sort_direction: "ascending" | "descending" }[];
};

export type SimplerSearchBody = {
  query?: string;
  query_operator?: "AND" | "OR";
  filters?: Record<string, unknown>;
  pagination: SimplerPagination;
  format?: "json" | "csv";
};

/**
 * Simpler nests deadlines, awards, instruments, and applicant types on the opportunity under
 * `summary` (object). Legacy payloads may use a string `summary` instead.
 */
export type SimplerOpportunitySummary = Record<string, unknown>;

/**
 * One file on the opportunity's detail record (`GET /v1/opportunities/{id}` only — the search
 * endpoint never returns `attachments`). Since late 2025 NIH publishes most NOFOs as a
 * `<number>-Full-Announcement.html` attachment here instead of a classic Guide page.
 */
export type SimplerAttachment = {
  file_name: string;
  /** e.g. "text/html;charset=ISO-8859-1" — match on the prefix. */
  mime_type?: string | null;
  /** Absolute https URL on files.simpler.grants.gov; the attachment UUID changes on re-upload. */
  download_path: string;
  file_size_bytes?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SimplerOpportunityHit = {
  opportunity_id: string;
  opportunity_number?: string | null;
  opportunity_title: string;
  agency_code?: string | null;
  agency_name?: string | null;
  post_date?: string | null;
  close_date?: string | null;
  opportunity_status?: string | null;
  funding_instrument?: string | null;
  funding_category?: string | null;
  award_floor?: number | null;
  award_ceiling?: number | null;
  applicant_types?: string[] | null;
  summary?: string | SimplerOpportunitySummary | null;
  is_cost_sharing?: boolean | null;
  /** Detail record only. */
  attachments?: SimplerAttachment[] | null;
  /** Detail record only; search hits carry `summary.updated_at` / `summary.created_at` instead. */
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type SimplerSearchResponse = {
  message?: string;
  data: SimplerOpportunityHit[];
  pagination_info?: {
    page_offset: number;
    page_size: number;
    total_pages?: number;
    total_records?: number;
  };
};
