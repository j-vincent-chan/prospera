/**
 * The NIH institutes and centers that issue funding notices, keyed by the
 * abbreviation the Guide and RePORTER use. `pattern` matches the abbreviation
 * as a word or the institute's full name, so it works on a Guide line
 * ("National Cancer Institute (NCI)"), a contact block ("NCI\nname@nci.nih.gov")
 * or prose. CSR, CIT and the Clinical Center do not fund grants and are left out.
 */
export type NihInstitute = {
  token: string;
  name: string;
  pattern: RegExp;
  /**
   * Forms that identify the institute only where the text names who issues or
   * participates (the Guide's participating-organizations section, a program
   * contact block). In prose the same names usually mean co-funding or
   * encouragement, not participation.
   */
  participantPattern?: RegExp;
};

export const NIH_INSTITUTES: readonly NihInstitute[] = [
  { token: "NCI", name: "National Cancer Institute", pattern: /\bNCI\b|National Cancer Institute/i },
  { token: "NEI", name: "National Eye Institute", pattern: /\bNEI\b|National Eye Institute/i },
  { token: "NHLBI", name: "National Heart, Lung, and Blood Institute", pattern: /\bNHLBI\b|National Heart,? Lung,? and Blood Institute/i },
  { token: "NHGRI", name: "National Human Genome Research Institute", pattern: /\bNHGRI\b|National Human Genome Research Institute/i },
  { token: "NIA", name: "National Institute on Aging", pattern: /\bNIA\b|National Institute on Aging/i },
  { token: "NIAAA", name: "National Institute on Alcohol Abuse and Alcoholism", pattern: /\bNIAAA\b|National Institute on Alcohol Abuse and Alcoholism/i },
  { token: "NIAID", name: "National Institute of Allergy and Infectious Diseases", pattern: /\bNIAID\b|National Institute of Allergy and Infectious Diseases/i },
  { token: "NIAMS", name: "National Institute of Arthritis and Musculoskeletal and Skin Diseases", pattern: /\bNIAMS\b|National Institute of Arthritis and Musculoskeletal and Skin Diseases/i },
  { token: "NIBIB", name: "National Institute of Biomedical Imaging and Bioengineering", pattern: /\bNIBIB\b|National Institute of Biomedical Imaging and Bioengineering/i },
  { token: "NICHD", name: "Eunice Kennedy Shriver National Institute of Child Health and Human Development", pattern: /\bNICHD\b|National Institute of Child Health/i },
  { token: "NIDCD", name: "National Institute on Deafness and Other Communication Disorders", pattern: /\bNIDCD\b|National Institute on Deafness and Other Communication Disorders/i },
  { token: "NIDCR", name: "National Institute of Dental and Craniofacial Research", pattern: /\bNIDCR\b|National Institute of Dental and Craniofacial Research/i },
  { token: "NIDDK", name: "National Institute of Diabetes and Digestive and Kidney Diseases", pattern: /\bNIDDK\b|National Institute o[fn] Diabetes and Digestive and Kidney Diseases/i },
  { token: "NIDA", name: "National Institute on Drug Abuse", pattern: /\bNIDA\b|National Institute on Drug Abuse/i },
  { token: "NIEHS", name: "National Institute of Environmental Health Sciences", pattern: /\bNIEHS\b|National Institute of Environmental Health Sciences/i },
  { token: "NIGMS", name: "National Institute of General Medical Sciences", pattern: /\bNIGMS\b|National Institute of General Medical Sciences/i },
  { token: "NIMH", name: "National Institute of Mental Health", pattern: /\bNIMH\b|National Institute of Mental Health/i },
  { token: "NIMHD", name: "National Institute on Minority Health and Health Disparities", pattern: /\bNIMHD\b|National Institute o[fn] Minority Health and Health Disparities/i },
  { token: "NINDS", name: "National Institute of Neurological Disorders and Stroke", pattern: /\bNINDS\b|National Institute of Neurological Disorders and Stroke/i },
  { token: "NINR", name: "National Institute of Nursing Research", pattern: /\bNINR\b|National Institute of Nursing Research/i },
  { token: "NLM", name: "National Library of Medicine", pattern: /\bNLM\b|National Library of Medicine/i },
  { token: "FIC", name: "Fogarty International Center", pattern: /\bFIC\b|Fogarty International Center/i },
  { token: "NCATS", name: "National Center for Advancing Translational Sciences", pattern: /\bNCATS\b|National Center for Advancing Translational Sciences/i },
  { token: "NCCIH", name: "National Center for Complementary and Integrative Health", pattern: /\bNCCIH\b|National Center for Complementary and Integrative Health/i },
  // The Office of the Director issues Common Fund and Roadmap notices (RFA-RM-…, RFA-OD-…) and, in the
  // Guide's participant list or a contact block, leads through its offices (ORWH, OBSSR, ODSS, ODP, ORIP,
  // OAR, ODS, ONR, THRO, SGMRO, OER's workforce division) and programs (ECHO, INCLUDE). A bare "OD" is too common a token to
  // trust in prose, so only the parenthesised form counts there.
  {
    token: "OD",
    name: "Office of the Director",
    pattern: /\(\s*OD\s*\)|Office of (?:the )?(?:NIH )?Director|Office of Strategic Coordination|\bCommon Fund\b/i,
    participantPattern:
      /\b(?:ORWH|OBSSR|ODSS|ODP|ORIP|OAR|ODS|ONR|THRO|SGMRO|DPCPSI|ECHO)\b|INCLUDE Project|Office of Research on Women's Health|Office of Behavioral and Social Sciences Research|Office of Data Science Strategy|Office of Disease Prevention|Office of Research Infrastructure Programs|Office of AIDS Research|Office of Dietary Supplements|Office of Nutrition Research|Office of Extramural Research|Division of Biomedical Research Workforce|Tribal Health Research Office|Sexual (?:&|and) Gender Minority Research Office|Division of Program Coordination, Planning and Strategic Initiatives|Environmental [Ii]nfluences on Child Health Outcomes/i,
  },
];

const BY_TOKEN = new Map(NIH_INSTITUTES.map((ic) => [ic.token, ic]));

/**
 * The institutes named in `text`, as sorted tokens; empty when none is. `participants`
 * says the text is a list of participating organizations, where an OD office counts.
 */
export function findNihInstitutes(text: string | null | undefined, opts: { participants?: boolean } = {}): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const ic of NIH_INSTITUTES) {
    if (ic.pattern.test(text) || (opts.participants && ic.participantPattern?.test(text))) found.push(ic.token);
  }
  return found.sort((a, b) => a.localeCompare(b));
}

export function nihInstituteName(token: string): string | null {
  return BY_TOKEN.get(token)?.name ?? null;
}

/**
 * The two-letter serial code NIH puts in RFA-XX-… / NOT-XX-… / FOR-XX-… numbers, → institute.
 * PA and PAR numbers carry no code. Mirrors `IC_BY_PREFIX` in `src/lib/institution/types.ts`
 * (grant serial numbers) but only for the tokens above.
 */
export const IC_BY_NOTICE_CODE: Readonly<Record<string, string>> = {
  AA: "NIAAA", AG: "NIA", AI: "NIAID", AR: "NIAMS", AT: "NCCIH", CA: "NCI", DA: "NIDA", DC: "NIDCD", DE: "NIDCR",
  DK: "NIDDK", EB: "NIBIB", ES: "NIEHS", EY: "NEI", GM: "NIGMS", HD: "NICHD", HG: "NHGRI", HL: "NHLBI", LM: "NLM",
  MD: "NIMHD", MH: "NIMH", NR: "NINR", NS: "NINDS", OD: "OD", RM: "OD", TR: "NCATS", TW: "FIC",
};

/** `RFA-AI-27-004` → `AI`; `NOT-CA-26-009` → `CA`; `FOR-AR-26-008` → `AR`; `PAR-27-026` → null (no code in the number). */
export function noticeInstituteCode(opportunityNumber: string | null | undefined): string | null {
  const m = /^(?:RFA|NOT|FOR)-([A-Z]{2})-/i.exec((opportunityNumber ?? "").trim());
  return m ? m[1]!.toUpperCase() : null;
}
