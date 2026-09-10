import { describe, expect, it } from "vitest";
import { adapterFor, adapterForFamily, isNihCorpusRow, type AnnouncementRow } from "./router";
import { GRANTS_GOV_ATTACHMENT_ADAPTER_ID } from "./adapters/grants-gov-attachment";
import { NSF_SOLICITATION_ADAPTER_ID } from "./adapters/nsf-solicitation";
import { CDMRP_PA_ADAPTER_ID } from "./adapters/cdmrp-pa";

function row(over: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    opportunity_number: "DFOP0019546",
    agency_code: "DOS-DRL",
    forecasted: false,
    source_opportunity_id: "11111111-1111-1111-1111-111111111111",
    raw_payload_json: {},
    ...over,
  } as AnnouncementRow;
}

describe("isNihCorpusRow — the guard the NIH invariant rests on", () => {
  it("matches NIH_NOTICE_FILTER: the agency code and all four number shapes", () => {
    expect(isNihCorpusRow({ agency_code: "HHS-NIH-NIAID", opportunity_number: "X" })).toBe(true);
    expect(isNihCorpusRow({ agency_code: null, opportunity_number: "PA-26-100" })).toBe(true);
    expect(isNihCorpusRow({ agency_code: null, opportunity_number: "PAR-25-122" })).toBe(true);
    expect(isNihCorpusRow({ agency_code: null, opportunity_number: "PAS-26-315" })).toBe(true);
    expect(isNihCorpusRow({ agency_code: null, opportunity_number: "RFA-DK-26-315" })).toBe(true);
  });

  it("is wider than funderFamilyOf: the CDC/AHRQ RFA- rows the Guide sync owns are refused here", () => {
    // 51 open rows sit in this gap and 13 already carry Guide-parsed sections.
    // funderFamilyOf calls these hhs_other; NIH_NOTICE_FILTER calls them NIH.
    expect(isNihCorpusRow({ agency_code: "HHS-CDC-NIOSH", opportunity_number: "RFA-OH-27-001" })).toBe(true);
    expect(adapterFor(row({ agency_code: "HHS-CDC-NIOSH", opportunity_number: "RFA-OH-27-001" }))).toBeNull();
  });

  it("does not fire on a null agency_code — the reason it is not a negated PostgREST filter", () => {
    expect(isNihCorpusRow({ agency_code: null, opportunity_number: "DFOP0019546" })).toBe(false);
  });
});

describe("adapterForFamily", () => {
  it("routes NSF and CDMRP to their own adapters and everything else to the attachment route", () => {
    expect(adapterForFamily("nsf")).toBe(NSF_SOLICITATION_ADAPTER_ID);
    expect(adapterForFamily("dod_cdmrp")).toBe(CDMRP_PA_ADAPTER_ID);
    expect(adapterForFamily("other_federal")).toBe(GRANTS_GOV_ATTACHMENT_ADAPTER_ID);
    expect(adapterForFamily("hhs_other")).toBe(GRANTS_GOV_ATTACHMENT_ADAPTER_ID);
    expect(adapterForFamily("doe")).toBe(GRANTS_GOV_ATTACHMENT_ADAPTER_ID);
  });

  it("gives a State Department notice the attachment adapter", () => {
    expect(adapterFor(row())).toBe(GRANTS_GOV_ATTACHMENT_ADAPTER_ID);
  });

  it("has no adapter for a foundation or an internal row", () => {
    expect(adapterFor(row({ source_system: "foundation" } as Partial<AnnouncementRow>))).toBeNull();
    expect(adapterFor(row({ source_system: "internal" } as Partial<AnnouncementRow>))).toBeNull();
  });
});
