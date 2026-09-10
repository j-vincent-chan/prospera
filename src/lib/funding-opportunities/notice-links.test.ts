import { describe, expect, it } from "vitest";
import { isGrantsGovAttachmentDownload, isInlineSimplerAttachment, noticeLinkLabel, resolveNoticeLinks } from "./notice-links";

const SIMPLER_ID = "2aaa85ab-169c-432e-806b-95a859bc94e2";
const SIMPLER_HTML = `https://files.simpler.grants.gov/opportunities/${SIMPLER_ID}/attachments/acba14a1-311b-44f0-8a0a-6bcf1dfbc840/RFA-HG-27-011-Full-Announcement.html`;
const GUIDE_PAGE = "https://grants.nih.gov/grants/guide/pa-files/PA-24-189.html";
const GRANTS_GOV_DOWNLOAD = "https://www.grants.gov/grantsws/rest/opportunity/att/download/353192";

describe("resolveNoticeLinks", () => {
  it("opens the NIH Guide page the sync read", () => {
    const links = resolveNoticeLinks({ guide_url: GUIDE_PAGE, guide_fetch_status: "ok", source_opportunity_id: "f689428f-2297-4752-8142-1d2e907b15a4", raw_payload_json: { legacy_opportunity_id: 353794 } });
    expect(links.announcement).toEqual({ url: GUIDE_PAGE, kind: "announcement", site: "NIH Guide" });
    expect(links.listing?.url).toBe("https://simpler.grants.gov/opportunity/f689428f-2297-4752-8142-1d2e907b15a4");
    expect(links.primary).toBe(links.announcement);
    expect(noticeLinkLabel(links.primary!)).toBe("Full announcement");
  });

  // NIH's 2027-series NOFOs have no grants.nih.gov page; the Simpler-hosted HTML is the announcement and renders in a browser.
  it("opens the Simpler-hosted full announcement when that is where the notice lives", () => {
    const links = resolveNoticeLinks({ guide_url: SIMPLER_HTML, guide_fetch_status: "ok", source_opportunity_id: SIMPLER_ID, raw_payload_json: { opportunity_id: SIMPLER_ID, legacy_opportunity_id: 359279 } });
    expect(links.announcement).toEqual({ url: SIMPLER_HTML, kind: "announcement", site: "Simpler.Grants.gov" });
    expect(links.listing).toEqual({ url: `https://simpler.grants.gov/opportunity/${SIMPLER_ID}`, kind: "listing", site: "Simpler.Grants.gov" });
    expect(links.primary?.url).toBe(SIMPLER_HTML);
  });

  it("never points at a Guide URL the sync found missing", () => {
    const links = resolveNoticeLinks({ guide_url: "https://grants.nih.gov/grants/guide/rfa-files/RFA-FD-26-012.html", guide_fetch_status: "not_found", source_opportunity_id: "758eb232-aa13-4c39-a651-e6429d961b03", raw_payload_json: {} });
    expect(links.announcement).toBeNull();
    expect(links.primary).toEqual({ url: "https://simpler.grants.gov/opportunity/758eb232-aa13-4c39-a651-e6429d961b03", kind: "listing", site: "Simpler.Grants.gov" });
    expect(noticeLinkLabel(links.primary!)).toBe("Simpler.Grants.gov");
  });

  // The non-NIH adapters store the Grants.gov attachment endpoint, which forces a download.
  it("never puts a forced download on the button", () => {
    const links = resolveNoticeLinks({ guide_url: GRANTS_GOV_DOWNLOAD, guide_fetch_status: "ok", source_opportunity_id: "362581", raw_payload_json: { legacy_opportunity_id: "362581" } });
    expect(links.announcement).toBeNull();
    expect(links.primary).toEqual({ url: "https://www.grants.gov/search-results-detail/362581", kind: "listing", site: "Grants.gov" });
  });

  it("treats a Simpler PDF attachment as a download too", () => {
    const pdf = `https://files.simpler.grants.gov/opportunities/${SIMPLER_ID}/attachments/x/NOFO.pdf`;
    expect(resolveNoticeLinks({ guide_url: pdf, guide_fetch_status: "ok", raw_payload_json: { opportunity_id: SIMPLER_ID } }).announcement).toBeNull();
    expect(isInlineSimplerAttachment(pdf)).toBe(false);
    expect(isInlineSimplerAttachment(SIMPLER_HTML)).toBe(true);
    expect(isGrantsGovAttachmentDownload(GRANTS_GOV_DOWNLOAD)).toBe(true);
    expect(isGrantsGovAttachmentDownload("https://apply07.grants.gov:443/grantsws/rest/opportunity/att/download/353192")).toBe(true);
    expect(isGrantsGovAttachmentDownload("https://www.grants.gov/search-results-detail/362581")).toBe(false);
  });

  it("keeps the agency's own program page as a third link, not as the announcement", () => {
    const links = resolveNoticeLinks({ guide_url: null, guide_fetch_status: "not_applicable", source_opportunity_id: "3bcda474-f002-4d74-8b8c-9b179df30300", raw_payload_json: { summary: { additional_info_url: "https://www.nih.gov/common-fund/pioneer-award" } } });
    expect(links.announcement).toBeNull();
    expect(links.listing?.site).toBe("Simpler.Grants.gov");
    expect(links.agency).toEqual({ url: "https://www.nih.gov/common-fund/pioneer-award", kind: "agency", site: "nih.gov" });
    expect(links.primary).toBe(links.listing);
  });

  it("falls back to the payload's best-effort source URL only when nothing better exists", () => {
    const links = resolveNoticeLinks({ guide_url: null, raw_payload_json: { summary: { summary_description: "See https://ma.usembassy.gov/education/funding-opportunities/ for details" } } });
    expect(links.announcement).toBeNull();
    expect(links.listing).toBeNull();
    expect(links.agency).toBeNull();
    expect(links.primary).toEqual({ url: "https://ma.usembassy.gov/education/funding-opportunities/", kind: "agency", site: "ma.usembassy.gov" });
    expect(noticeLinkLabel(links.primary!)).toBe("Agency site");
  });

  it("has nothing to offer for a row with no ids and no URLs", () => {
    expect(resolveNoticeLinks({ raw_payload_json: null }).primary).toBeNull();
  });
});
