# Fit engine · non-NIH inventory (PR 5.0)

Generated 2026-09-08T02:04:25.611Z by `npm run fit:non-nih-inventory` (seed 20260907, legacy sample 50, ≥ 700 ms per host). Read-only: Supabase reads are `select()` only and every outbound request is a GET or a search POST to one of 6 allow-listed hosts. "Open" = `close_date`, `next_due` or `expiration_date` on/after 2026-09-08. Answers the nine questions in `docs/fit-engine/NON_NIH_PLAN.md` § PR 5.0.

## 1. The corpus, by agency, assistance listing, forecast status and profile

| Metric | Value |
|---|---|
| open notices | 1302 |
| NIH-like (mirrors `NIH_NOTICE_FILTER`) | 655 |
| non-NIH | 647 |
| — posted | 536 |
| — forecast | 111 |
| non-NIH with an `opportunity_fit_profiles` row | 0 |
| NIH-like with a profile row | 436 |
| `isNihLike()` agrees with PostgREST's `NIH_NOTICE_FILTER` | yes |

`NIH-like` is the Guide sync's own target set, not an agency test: a CDC `RFA-OH-…` number is NIH-like here (NON_NIH_FEASIBILITY § 1 — those notices are already in the `ok` / `not_found` population) while an `HHS-CDC-GHC` notice numbered `CDC-RFA-GH…` is not.

### 1a. Non-NIH open notices × `agency_code` × forecast × profile

| agency_code | agency | posted | forecast | with profile | total |
|---|---|---|---|---|---|
| NSF | U.S. National Science Foundation | 91 | 0 | 0 | 91 |
| DOD-AMRAA | Defense Health Agency Contracting Activity - DHACA | 81 | 0 | 0 | 81 |
| HHS-HRSA | Health Resources and Services Administration | 1 | 50 | 0 | 51 |
| USDOJ-OJP-BJA | Bureau of Justice Assistance | 20 | 0 | 0 | 20 |
| HHS-IHS | Indian Health Service | 0 | 16 | 0 | 16 |
| USDA-NIFA | National Institute of Food and Agriculture | 15 | 0 | 0 | 15 |
| DOI-FWS | Fish and Wildlife Service | 14 | 0 | 0 | 14 |
| HHS-CDC-GHC | Centers for Disease Control-GHC | 11 | 3 | 0 | 14 |
| HUD | Department of Housing and Urban Development | 6 | 8 | 0 | 14 |
| DOS-GTIP | Office to Monitor-Combat Trafficking in Persons | 13 | 0 | 0 | 13 |
| IMLS | Institute of Museum and Library Services | 13 | 0 | 0 | 13 |
| NASA-HQ | NASA Headquarters | 12 | 0 | 0 | 12 |
| DOC-DOCNOAAERA | DOC NOAA - ERA Production | 11 | 0 | 0 | 11 |
| DOS-GHSD | Bureau of Global Health Security and Diplomacy | 10 | 0 | 0 | 10 |
| DOD-AFRL | Air Force -- Research Lab | 9 | 0 | 0 | 9 |
| DOD-AMC | Dept of the Army -- Materiel Command | 9 | 0 | 0 | 9 |
| DOD-COE-FW | Fort Worth District | 9 | 0 | 0 | 9 |
| DOI-BLM | Bureau of Land Management | 8 | 0 | 0 | 8 |
| HHS-CDC-NCHHSTP | Centers for Disease Control - NCHHSTP | 0 | 8 | 0 | 8 |
| DOI-BOR | Bureau of Reclamation | 7 | 0 | 0 | 7 |
| HHS-CDC-NCIPC | Centers for Disease Control - NCIPC | 0 | 7 | 0 | 7 |
| USDOJ-OJP-OVC | Office for Victims of Crime | 7 | 0 | 0 | 7 |
| DOD-WHS | Washington Headquarters Services | 5 | 1 | 0 | 6 |
| DOI-NPS | National Park Service | 6 | 0 | 0 | 6 |
| DOI-USGS1 | Geological Survey | 6 | 0 | 0 | 6 |
| USDOJ-OJP-BJS | Bureau of Justice Statistics | 6 | 0 | 0 | 6 |
| DOD-ONR | Office of Naval Research | 5 | 0 | 0 | 5 |
| DOL-ILAB | Bureau of International Labor Affairs | 5 | 0 | 0 | 5 |
| DOS-ECA | Bureau Of Educational and Cultural Affairs | 5 | 0 | 0 | 5 |
| ED | Department of Education | 5 | 0 | 0 | 5 |
| NEA | National Endowment for the Arts | 5 | 0 | 0 | 5 |
| USDA-FS | Forest Service | 5 | 0 | 0 | 5 |
| USDOJ-OJP-OVW | Office on Violence Against Women | 5 | 0 | 0 | 5 |
| DOD-AFOSR | Air Force Office of Scientific Research | 4 | 0 | 0 | 4 |
| DOE-ID | Idaho Field Office | 4 | 0 | 0 | 4 |
| DOE-NETL | National Energy Technology Laboratory | 4 | 0 | 0 | 4 |
| DOS-AF | Bureau of African Affairs | 4 | 0 | 0 | 4 |
| DOS-NEA | Bureau of Near Eastern Affairs | 4 | 0 | 0 | 4 |
| DOS-SAU | U.S. Mission to Saudi Arabia | 4 | 0 | 0 | 4 |
| DOT-FTA | DOT - Federal Transit Administration | 4 | 0 | 0 | 4 |
| EPA | Environmental Protection Agency | 4 | 0 | 0 | 4 |
| HHS-CDC-NCEZID | Centers for Disease Control - NCEZID | 1 | 3 | 0 | 4 |
| DHS-DHS | Department of Homeland Security - FEMA | 3 | 0 | 0 | 3 |
| DOC-NIST | National Institute of Standards and Technology | 3 | 0 | 0 | 3 |
| DOE-GFO | Golden Field Office | 3 | 0 | 0 | 3 |
| DOL-ETA | Employment and Training Administration | 3 | 0 | 0 | 3 |
| DOS-DRL | Bureau of Democracy Human Rights and Labor | 3 | 0 | 0 | 3 |
| DOS-INL | Bureau of International Narcotics-Law Enforcement | 3 | 0 | 0 | 3 |
| DOT-FHWA | DOT Federal Highway Administration | 3 | 0 | 0 | 3 |
| HHS-ACF | Administration for Children and Families | 1 | 2 | 0 | 3 |
| HHS-ACF-OFVPS | Administration for Children and Families - OFVPS | 3 | 0 | 0 | 3 |
| HHS-ACF-ORR | Administration for Children and Families - ORR | 2 | 1 | 0 | 3 |
| HHS-CDC-NCBDDD | Centers for Disease Control - NCBDDD | 1 | 2 | 0 | 3 |
| HHS-CDC-NCCDPHP | Centers for Disease Control - NCCDPHP | 1 | 2 | 0 | 3 |
| NEH | National Endowment for the Humanities | 3 | 0 | 0 | 3 |
| USDA-AMS | Agricultural Marketing Service | 3 | 0 | 0 | 3 |
| USDOT-GCR | U.S. Dept. of Treasury RESTORE Act Program | 3 | 0 | 0 | 3 |
| AC | AmeriCorps | 2 | 0 | 0 | 2 |
| DOC-DOCNISTERA | DOC NIST ERA | 2 | 0 | 0 | 2 |
| DOD-AFRL-RW | Munitions Directorate | 2 | 0 | 0 | 2 |
| DOD-DARPA-DSO | DARPA - Defense Sciences Office | 2 | 0 | 0 | 2 |
| DOE-ARPAE | Advanced Research Projects Agency Energy | 2 | 0 | 0 | 2 |
| DOS-CA | Bureau of Consular Affairs | 2 | 0 | 0 | 2 |
| DOS-PAN | U.S. Mission to Panama | 2 | 0 | 0 | 2 |
| HHS-ACF-OCS | Administration for Children and Families - OCS | 2 | 0 | 0 | 2 |
| HHS-ACF-OHS | Administration for Children and Families - OHS | 0 | 2 | 0 | 2 |
| PAMS-SC | Office of Science | 2 | 0 | 0 | 2 |
| USDA-APHIS | Animal and Plant Health Inspection Service | 2 | 0 | 0 | 2 |
| USDA-FAS | Foreign Agricultural Service | 2 | 0 | 0 | 2 |
| USDA-NRCS | Natural Resources Conservation Service | 2 | 0 | 0 | 2 |
| USDA-RUS | Rural Utilities Service | 1 | 1 | 0 | 2 |
| DOC-NTIA | National Telecommunications and Information Admini | 1 | 0 | 0 | 1 |
| DOD-AF347CS | USAF 347 Contracting Squadron | 1 | 0 | 0 | 1 |
| DOD-AMC-ACCAPGN | ACC APG - Natick | 1 | 0 | 0 | 1 |
| DOD-COE-ERDC | Engineer Research and Development Center | 1 | 0 | 0 | 1 |
| DOD-DARPA-BTO | DARPA - Biological Technologies Office | 1 | 0 | 0 | 1 |
| DOD-DARPA-IPTO | DARPA - Information Processing Technologies Office | 1 | 0 | 0 | 1 |
| DOD-DARPA-TTO | DARPA - Tactical Technology Office | 1 | 0 | 0 | 1 |
| DOD-DTRA | Defense Threat Reduction Agency | 1 | 0 | 0 | 1 |
| DOD-NGIA | National Geospatial-Intelligence Agency | 1 | 0 | 0 | 1 |
| DOD-ONR-NRL | Naval Research Laboratory | 1 | 0 | 0 | 1 |
| DOD-ONR-SUP | Naval Supply Systems Command | 1 | 0 | 0 | 1 |
| DOL-ETA-VETS | Veterans Employment and Training Service | 1 | 0 | 0 | 1 |
| DOS-AIT | American Institute in Taiwan | 1 | 0 | 0 | 1 |
| DOS-ARM | U.S. Mission to Armenia | 1 | 0 | 0 | 1 |
| DOS-AUS | U.S. Mission to Australia | 1 | 0 | 0 | 1 |
| DOS-AUT | U.S. Mission to Austria | 1 | 0 | 0 | 1 |
| DOS-BIH | U.S. Mission to Bosnia and Herzegovina | 1 | 0 | 0 | 1 |
| DOS-IRQ | U.S. Mission to Iraq | 1 | 0 | 0 | 1 |
| DOS-NEA-AC | Assistance Coordination | 1 | 0 | 0 | 1 |
| DOS-NZL | U.S. Mission to New Zealand | 1 | 0 | 0 | 1 |
| DOS-TUN | U.S. Mission to Tunisia | 1 | 0 | 0 | 1 |
| DOS-ZWE | U.S. Mission to Zimbabwe | 1 | 0 | 0 | 1 |
| DOT-DOT X-50 | Office of the Under Secretary for Policy | 0 | 1 | 0 | 1 |
| DOT-FAA-FAA ARG | DOT - FAA Aviation Research Grants | 1 | 0 | 0 | 1 |
| DOT-FAA-FAA COE-AJFE | FAA-COE-AJFE | 1 | 0 | 0 | 1 |
| DOT-FAA-FAA COE-TTHP | FAA-COE-TTHP | 1 | 0 | 0 | 1 |
| DOT-FMCSA | DOT-Federal Motor Carrier Safety Administration | 1 | 0 | 0 | 1 |
| DOT-FRA | DOT - Federal Railroad Administration | 1 | 0 | 0 | 1 |
| DOT-NHTSA | National Highway Traffic Safety Administration | 1 | 0 | 0 | 1 |
| HHS-ACF-OTIP | Administration for Children and Families-IOAS-OTIP | 0 | 1 | 0 | 1 |
| HHS-CDC-CSTLTS | CENTERS FOR DISEASE CONTROL  CSTLTS | 0 | 1 | 0 | 1 |
| HHS-CDC-OD | Centers for Disease Control - OD | 0 | 1 | 0 | 1 |
| HHS-CDC-OPHPR | Centers for Disease Control - OPHPR | 1 | 0 | 0 | 1 |
| HHS-OS-ASPR | Assistant Secretary for Preparedness and Response | 1 | 0 | 0 | 1 |
| HHS-OS-ONC | Office of the National Coordinator | 1 | 0 | 0 | 1 |
| LOC | Library of Congress | 1 | 0 | 0 | 1 |
| ONDCP | Office of National Drug Control Policy | 1 | 0 | 0 | 1 |
| SBA | Small Business Administration | 1 | 0 | 0 | 1 |
| USDA-RHS | Rural Housing Service | 1 | 0 | 0 | 1 |
| VA-VLGP | Veterans Legacy Grants Program | 0 | 1 | 0 | 1 |

### 1b. Non-NIH open notices × funder family (PR 5.2's registry)

| family | posted | forecast | with profile | total |
|---|---|---|---|---|
| other_federal | 270 | 11 | 0 | 281 |
| hhs_other | 26 | 99 | 0 | 125 |
| nsf | 91 | 0 | 0 | 91 |
| dod_cdmrp | 81 | 0 | 0 | 81 |
| dod_other | 55 | 1 | 0 | 56 |
| doe | 13 | 0 | 0 | 13 |

### 1c. Non-NIH posted notices × `category` (Simpler's funding category)

| category | count |
|---|---|
| discretionary | 509 |
| other | 17 |
| mandatory | 8 |
| earmark | 2 |

### 1d. Reconciliation with `GUIDE_DIAGNOSTICS.md` § 1e (never-fetched rows × family × status)

| family (agency_code) | Simpler status | count | § 1e (2026-09-05) |
|---|---|---|---|
| non-HHS | posted | 510 | 512 |
| other HHS | forecast | 72 | 72 |
| CDC | forecast | 27 | 27 |
| CDC | posted | 15 | 15 |
| non-HHS | forecast | 12 | 12 |
| other HHS | posted | 11 | 11 |

Never fetched, non-NIH by agency family: **536 posted** (§ 1e: 512 + 15 + 11 = 538) and **111 forecast** (§ 1e: 72 + 27 + 12 = 111). The addressable set this phase is sized against is the posted half.

### 1e. Non-NIH posted notices × assistance listing (top 30)

| assistance listing | program title | notices |
|---|---|---|
| 12.420 | Military Medical Research and Development | 80 |
| 47.049 | Mathematical and Physical Sciences | 46 |
| 47.076 | STEM Education (formerly Education and Human Resources) | 31 |
| 47.041 | Engineering | 29 |
| 47.070 | Computer and Information Science and Engineering | 27 |
| 47.050 | Geosciences | 26 |
| 47.075 | Social, Behavioral, and Economic Sciences | 26 |
| 47.074 | Biological Sciences | 19 |
| 47.084 | NSF Technology, Innovation, and Partnerships | 19 |
| 12.800 | Air Force Defense Research Sciences Program | 14 |
| 47.083 | Integrative Activities | 14 |
| 19.019 | International Programs to Combat Human Trafficking | 13 |
| 43.001 | Science | 12 |
| 19.040 | Public Diplomacy Programs | 11 |
| 47.079 | Office of International Science and Engineering | 11 |
| 12.431 | Basic Scientific Research | 10 |
| 19.029 | The U.S. President's Emergency Plan for AIDS Relief Programs | 10 |
| 93.318 | Protecting and Improving Health Globally: Building and Strengthening Public Health Impact, Systems, Capacity and Security | 10 |
| 12.005 | Conservation and Rehabilitation of Natural Resources on Military Installations | 9 |
| 12.300 | Basic and Applied Scientific Research | 7 |
| 11.015 | Broad Agency Announcement | 6 |
| 12.910 | Research and Technology Development | 6 |
| 15.808 | U.S. Geological Survey Research and Data Collection | 5 |
| 16.320 | Services for Trafficking Victims | 5 |
| 17.401 | International Labor Programs | 5 |
| 19.415 | Professional and Cultural Exchange Programs - Citizen Exchanges | 5 |
| 12.630 | Basic, Applied, and Advanced Research in Science and Engineering | 4 |
| 16.738 | Edward Byrne Memorial Justice Assistance Grant Program | 4 |
| 16.812 | Second Chance Act Reentry Initiative | 4 |
| 19.600 | Bureau of Near Eastern Affairs | 4 |

Distinct assistance listings among the 536 posted non-NIH notices: **213**; rows carrying none: **0**. Cross-tabulated with agency, and with example titles, in § 7d — as description, not as a filter.

## 2. The attachment hit-rate (Simpler detail, and the legacy Grants.gov route)

| Metric | Value |
|---|---|
| posted non-NIH rows | 536 |
| with `raw_payload_json.legacy_opportunity_id` | 536 (100.0 %) |
| with `attachments[]` already in `raw_payload_json` | 8 |

> **Correction to NON_NIH_FEASIBILITY § 5 and NON_NIH_PLAN § PR 5.0(2).** Both say the legacy Grants.gov route "needs a numeric Grants.gov id the row does **not** store", costing one `search2` call per row. The rows do store it: Simpler returns `legacy_opportunity_id` and `simpler-grants-sync.ts` keeps the whole hit in `raw_payload_json`. The agreement between that stored id and `searchGrantsGovOpportunityId()` is measured below; where they agree, PR 5.3's adapter can skip the search call entirely.

### 2a. Simpler `GET /v1/opportunities/{id}` over 536 posted non-NIH rows

| Metric | Value |
|---|---|
| rows probed | 536 |
| detail call failed | 32 |
| rows with ≥ 1 attachment | 328 / 504 (65.1 %) |
| attachments in total | 892 |
| attachments per row with any (median) | 1 |
| attachment size, median bytes | 304202.5 |
| attachment size, p90 bytes | 1071252.2 |

**Hit-rate by agency**

| agency_code | probed | with ≥ 1 attachment | rate |
|---|---|---|---|
| NSF | 90 | 0 | 0.0 % |
| DOD-AMRAA | 81 | 81 | 100.0 % |
| USDOJ-OJP-BJA | 20 | 0 | 0.0 % |
| USDA-NIFA | 15 | 15 | 100.0 % |
| DOI-FWS | 14 | 14 | 100.0 % |
| IMLS | 13 | 13 | 100.0 % |
| NASA-HQ | 12 | 1 | 8.3 % |
| HHS-CDC-GHC | 11 | 11 | 100.0 % |
| DOC-DOCNOAAERA | 9 | 9 | 100.0 % |
| DOD-AFRL | 9 | 5 | 55.6 % |
| DOD-AMC | 9 | 9 | 100.0 % |
| DOD-COE-FW | 9 | 9 | 100.0 % |
| DOI-BLM | 8 | 5 | 62.5 % |
| DOI-BOR | 7 | 7 | 100.0 % |
| DOS-GTIP | 7 | 6 | 85.7 % |
| USDOJ-OJP-OVC | 7 | 0 | 0.0 % |
| DOI-NPS | 6 | 6 | 100.0 % |
| DOI-USGS1 | 6 | 6 | 100.0 % |
| HUD | 6 | 5 | 83.3 % |
| USDOJ-OJP-BJS | 6 | 0 | 0.0 % |
| DOD-ONR | 5 | 5 | 100.0 % |
| DOD-WHS | 5 | 4 | 80.0 % |
| DOL-ILAB | 5 | 5 | 100.0 % |
| ED | 5 | 5 | 100.0 % |
| NEA | 5 | 0 | 0.0 % |
| USDA-FS | 5 | 5 | 100.0 % |
| USDOJ-OJP-OVW | 5 | 0 | 0.0 % |
| DOD-AFOSR | 4 | 4 | 100.0 % |
| DOE-ID | 4 | 4 | 100.0 % |
| DOE-NETL | 4 | 4 | 100.0 % |
| DOS-SAU | 4 | 4 | 100.0 % |
| DOT-FTA | 4 | 4 | 100.0 % |
| EPA | 4 | 4 | 100.0 % |
| DHS-DHS | 3 | 3 | 100.0 % |
| DOC-NIST | 3 | 3 | 100.0 % |
| DOE-GFO | 3 | 1 | 33.3 % |
| DOL-ETA | 3 | 3 | 100.0 % |
| DOS-INL | 3 | 3 | 100.0 % |
| DOT-FHWA | 3 | 3 | 100.0 % |
| HHS-ACF-OFVPS | 3 | 3 | 100.0 % |
| NEH | 3 | 3 | 100.0 % |
| USDA-AMS | 3 | 3 | 100.0 % |
| USDOT-GCR | 3 | 0 | 0.0 % |
| AC | 2 | 0 | 0.0 % |
| DOC-DOCNISTERA | 2 | 2 | 100.0 % |
| DOD-DARPA-DSO | 2 | 2 | 100.0 % |
| DOE-ARPAE | 2 | 1 | 50.0 % |
| DOS-ECA | 2 | 2 | 100.0 % |
| DOS-NEA | 2 | 2 | 100.0 % |
| DOS-PAN | 2 | 0 | 0.0 % |
| HHS-ACF-OCS | 2 | 2 | 100.0 % |
| HHS-ACF-ORR | 2 | 2 | 100.0 % |
| PAMS-SC | 2 | 2 | 100.0 % |
| USDA-APHIS | 2 | 2 | 100.0 % |
| USDA-FAS | 2 | 2 | 100.0 % |
| USDA-NRCS | 2 | 2 | 100.0 % |
| DOC-NTIA | 1 | 1 | 100.0 % |
| DOD-AF347CS | 1 | 0 | 0.0 % |
| DOD-AMC-ACCAPGN | 1 | 0 | 0.0 % |
| DOD-COE-ERDC | 1 | 0 | 0.0 % |
| DOD-DARPA-BTO | 1 | 1 | 100.0 % |
| DOD-DARPA-IPTO | 1 | 1 | 100.0 % |
| DOD-DARPA-TTO | 1 | 1 | 100.0 % |
| DOD-DTRA | 1 | 1 | 100.0 % |
| DOD-NGIA | 1 | 1 | 100.0 % |
| DOD-ONR-NRL | 1 | 1 | 100.0 % |
| DOD-ONR-SUP | 1 | 1 | 100.0 % |
| DOL-ETA-VETS | 1 | 1 | 100.0 % |
| DOS-AF | 1 | 1 | 100.0 % |
| DOS-AIT | 1 | 1 | 100.0 % |
| DOS-ARM | 1 | 1 | 100.0 % |
| DOS-AUS | 1 | 1 | 100.0 % |
| DOS-AUT | 1 | 0 | 0.0 % |
| DOS-BIH | 1 | 1 | 100.0 % |
| DOS-CA | 1 | 1 | 100.0 % |
| DOS-DRL | 1 | 1 | 100.0 % |
| DOS-GHSD | 1 | 1 | 100.0 % |
| DOS-IRQ | 1 | 0 | 0.0 % |
| DOS-NEA-AC | 1 | 1 | 100.0 % |
| DOS-NZL | 1 | 0 | 0.0 % |
| DOS-TUN | 1 | 0 | 0.0 % |
| DOS-ZWE | 1 | 1 | 100.0 % |
| DOT-FAA-FAA ARG | 1 | 1 | 100.0 % |
| DOT-FAA-FAA COE-AJFE | 1 | 0 | 0.0 % |
| DOT-FAA-FAA COE-TTHP | 1 | 0 | 0.0 % |
| DOT-FMCSA | 1 | 1 | 100.0 % |
| DOT-FRA | 1 | 0 | 0.0 % |
| DOT-NHTSA | 1 | 1 | 100.0 % |
| HHS-ACF | 1 | 1 | 100.0 % |
| HHS-CDC-NCBDDD | 1 | 1 | 100.0 % |
| HHS-CDC-NCCDPHP | 1 | 0 | 0.0 % |
| HHS-CDC-NCEZID | 1 | 1 | 100.0 % |
| HHS-CDC-OPHPR | 1 | 1 | 100.0 % |
| HHS-HRSA | 1 | 1 | 100.0 % |
| HHS-OS-ASPR | 1 | 1 | 100.0 % |
| LOC | 1 | 1 | 100.0 % |
| ONDCP | 1 | 0 | 0.0 % |
| SBA | 1 | 1 | 100.0 % |
| USDA-RHS | 1 | 1 | 100.0 % |
| USDA-RUS | 1 | 1 | 100.0 % |

**Mime-type mix**

| mime_type | attachments |
|---|---|
| application/pdf | 625 |
| application/octet-stream | 111 |
| application/vnd.openxmlformats-officedocument.wordprocessingml.document | 102 |
| application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | 42 |
| application/x-zip-compressed | 5 |
| image/jpeg | 5 |
| application/msword | 2 |

**File-name patterns** (a name can match more than one)

| pattern | attachments | share of all |
|---|---|---|
| `*-Full-Announcement.html` | 7 | 0.8 % |
| `*_GG*.pdf` (CDMRP Grants.gov mirror) | 74 | 8.3 % |
| `nofo` | 133 | 14.9 % |
| `foa` | 59 | 6.6 % |
| `program announcement` | 0 | 0.0 % |
| `solicitation` | 5 | 0.6 % |
| `instructions` / `application package` | 40 | 4.5 % |
| `.pdf` extension | 690 | 77.4 % |
| `.html` / `.htm` extension | 0 | 0.0 % |
| `.docx` / `.doc` extension | 136 | 15.2 % |

**Rows with no attachment, by agency** — these fall back to the synopsis (§ 3) and would be capped at Exploratory by the § 7.1 cap

| agency_code | rows with 0 attachments |
|---|---|
| NSF | 90 |
| USDOJ-OJP-BJA | 20 |
| NASA-HQ | 11 |
| USDOJ-OJP-OVC | 7 |
| USDOJ-OJP-BJS | 6 |
| NEA | 5 |
| USDOJ-OJP-OVW | 5 |
| DOD-AFRL | 4 |
| DOI-BLM | 3 |
| USDOT-GCR | 3 |
| AC | 2 |
| DOE-GFO | 2 |
| DOS-PAN | 2 |
| DOD-AF347CS | 1 |
| DOD-AMC-ACCAPGN | 1 |
| DOD-COE-ERDC | 1 |
| DOD-WHS | 1 |
| DOE-ARPAE | 1 |
| DOS-AUT | 1 |
| DOS-GTIP | 1 |
| DOS-IRQ | 1 |
| DOS-NZL | 1 |
| DOS-TUN | 1 |
| DOT-FAA-FAA COE-AJFE | 1 |
| DOT-FAA-FAA COE-TTHP | 1 |
| DOT-FRA | 1 |
| HHS-CDC-NCCDPHP | 1 |
| HUD | 1 |
| ONDCP | 1 |

**Detail calls that failed**

| opportunity_number | error |
|---|---|
| 26-514 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "87ab44df-fdf8-4cb9-8ee6-7cbea0678c05",   "message": "Could not fin |
| DFOP0017180 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "add54876-25bb-4ad8-88ad-8a3e541b60b1",   "message": "Could not fin |
| DFOP0017180 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "bdff24ff-f66a-406d-9fff-99abd1a24ea8",   "message": "Could not fin |
| DFOP0017180 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "b3a6e0ed-af3f-4aab-80b0-5711fe8d942e",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "7e2db5c7-2f32-4559-9a5e-c5b71da8a934",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "5928bef1-eae0-4255-8cdc-f60129b5f304",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "58e25e60-886d-472a-9280-b2d111f1e6e2",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "9f01bcfd-466a-41b3-9d0e-f9e583ba8ebe",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "e221b48b-7c7f-4095-9f6a-d672fd529818",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "8045c817-0e0a-47ea-9132-f4e90fba86aa",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "d7bc250c-a0e0-481b-ba7a-3bc98c4797bc",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "e8cc3423-2fe5-4f59-9963-0f18888b673b",   "message": "Could not fin |
| DFOP0017890 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "5da76c36-5140-43a1-b310-0aaa48249d47",   "message": "Could not fin |
| DFOP0018453 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "ae2e3019-8bc9-4e88-815c-9fd90a51100c",   "message": "Could not fin |
| DFOP0018712 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "0292a244-865b-42fd-b14e-4818c5aa13c6",   "message": "Could not fin |
| DFOP0018712 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "181f3dd9-22bf-4b02-ba2e-be3dd74b1b18",   "message": "Could not fin |
| DFOP0018770 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "2a95e4e1-c97a-442f-b4c4-d5c2f0d5be65",   "message": "Could not fin |
| DFOP0018770 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "5b41653c-07c0-4933-9955-8c7b9f687132",   "message": "Could not fin |
| DFOP0018774 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "965355ef-262f-4dcf-b8de-74234fa4db23",   "message": "Could not fin |
| DFOP0018774 | Simpler get opportunity failed: 404 {   "data": {},   "errors": [],   "internal_request_id": "94a7321b-0829-46c8-b992-157b195c7faf",   "message": "Could not fin |

**A sample of what came back**

| opportunity_number | agency_code | file_name | mime_type | bytes |
|---|---|---|---|---|
| 030ADV26R0050 | LOC | 030ADV26R0050_-_Full_Announcement_-_NOFO.zip | application/x-zip-compressed | 1059146 |
| 030ADV26R0050 | LOC | 01_-_030ADV26R0050_-_0001_-_NOFO_-_LHI_-_2027-2029_.pdf | application/pdf | 419770 |
| 20-01 | DOT-FAA-FAA ARG | NOFO_20-01.myb.pdf | application/pdf | 1413638 |
| 20-01 | DOT-FAA-FAA ARG | FAA_Non-Discrimination_Assurances_V1.1.pdf | application/pdf | 1513365 |
| 2023-NIST-CHIPS-SMME-01 | DOC-NIST | CHIPS_-_Facilities_for_Semiconductor_Materials_and_Manufacturing_Equipment_NOFO.pdf | application/pdf | 643184 |
| 2023-NIST-CHIPS-SMME-01 | DOC-NIST | 2023-NIST-CHIPS-SMME-01-Amendment.pdf | application/pdf | 424786 |
| 2025-NIST-CHIPS-CRDO-01 | DOC-NIST | CRDO_BAA_Amendment_2_Final.pdf | application/pdf | 197408 |
| 2025-NIST-CHIPS-CRDO-01 | DOC-NIST | CRDO_BAA_Subawardees_and_Unfunded_Collaborators.docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | 88239 |
| 2025-NIST-MSE-01 | DOC-NIST | Coversheet_Amendment_FY25_MSE.pdf | application/pdf | 161417 |
| 2025-NIST-MSE-01 | DOC-NIST | FY25_MSE_NOFO_Amendment.pdf | application/pdf | 815864 |
| 2026-NTIA-NEGP | DOC-DOCNISTERA | NTIA_Amended_NEGP_NOFO_2026.pdf | application/pdf | 450588 |
| 2026-NTIA-NEGP | DOC-DOCNISTERA | TBCP3_NEGP_NOFO_Technical_Amendment_2026.pdf | application/pdf | 121484 |
| 2026-NTIA-TBCP | DOC-DOCNISTERA | NTIA_Amended_TBCP3_NOFO_2026.pdf | application/pdf | 540808 |
| 2026-NTIA-TBCP | DOC-DOCNISTERA | TBCP3_NEGP_NOFO_Technical_Amendment_2026.pdf | application/pdf | 121484 |
| 20260511-PCS | NEH | Collections_Stewardship_2026_NOFO.pdf | application/octet-stream | 414408 |
| 20260511-PCS | NEH | NEH_General_Application_Guide.pdf | application/octet-stream | 731714 |
| 20260916-RQ | NEH | Scholarly_Editions_2026_NOFO.pdf | application/octet-stream | 522524 |
| 20260916-RQ | NEH | NEH_General_Application_Guide.pdf | application/octet-stream | 731714 |
| 20260916-RZ | NEH | NEH_General_Application_Guide.pdf | application/octet-stream | 731714 |
| 20260916-RZ | NEH | Collaborative_Research_2026_NOFO_070826.pdf | application/octet-stream | 424826 |
| 21MP-FY27 | IMLS | fy27-oms-21mp-NOFO.pdf | application/octet-stream | 869376 |
| AAHC-FY27 | IMLS | fy27-oms-aahc-NOFO.pdf | application/octet-stream | 858909 |
| AF-HAR-FY26-03 | DOS-ZWE | FY26_-_Annual_Program_Statement_03.pdf | application/pdf | 483450 |
| AF-HAR-FY26-03 | DOS-ZWE | USPD_Suggested_Budget_Template.xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | 24921 |
| ALHC-FY27 | IMLS | fy27-oms-alhc-NOFO.pdf | application/octet-stream | 845610 |
| ASSF-FY26-ARM-2 | DOS-ARM | Embassy_Yerevan_NOFO_ASSF-FY26-ARM-2.docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | 140909 |
| ASSF-FY26-ARM-2 | DOS-ARM | NOFO_QA.docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | 22719 |

### 2b. The legacy Grants.gov route on 50 of those rows

| Metric | Value |
|---|---|
| rows sampled | 50 |
| `searchGrantsGovOpportunityId()` resolved an id | 50 (100.0 %) |
| stored `legacy_opportunity_id` present | 50 |
| stored id **equals** the searched id | 50 / 50 (100.0 %) |
| `fetchOpportunity` returned a record | 50 |
| same **number** of files on both routes | 50 / 50 (100.0 %) |
| file names identical verbatim | 20 / 50 (40.0 %) |
| file names identical after `[ _]+ → _` | 41 / 50 (82.0 %) |
| file names identical with punctuation folded away | 50 / 50 (100.0 %) |

Simpler URL-safes the name it serves and drops punctuation grants.gov keeps (`…-Part 2.pdf` → `…-Part_2.pdf`, `M&E` → `ME`, `…_(1).xlsx` → `…_1.xlsx`), so the verbatim comparison understates the agreement badly. The folded row is the one to read: it can hide a difference of punctuation, never a missing or extra file, so **where it reaches 100 % the two routes returned the same set of files** and PR 5.3 may treat them as interchangeable.

| opportunity_number | agency_code | stored id | search2 id | same id | legacy files | simpler files | same set |
|---|---|---|---|---|---|---|---|
| DFOP0018775 | DOS-GTIP | 363383 | 363383 | yes | 2 | 2 | yes |
| 24-584 | NSF | 355100 | 355100 | yes | 0 | 0 | yes |
| PDS-PAN-FY26-02 | DOS-PAN | 363739 | 363739 | yes | 0 | 0 | yes |
| ED-GRANTS-080626-004 | ED | 363469 | 363469 | yes | 1 | 1 | yes |
| USDA-AMS-TM-SCMP-G-26-0020 | USDA-AMS | 361876 | 361876 | yes | 1 | 1 | yes |
| HT942526DMDRPCTRA | DOD-AMRAA | 362851 | 362851 | yes | 1 | 1 | yes |
| USDA-FS-UCF-01-2026 | USDA-FS | 361315 | 361315 | yes | 3 | 3 | no |
| HR001126S0015 | DOD-DARPA-DSO | 363738 | 363738 | yes | 17 | 17 | yes |
| G26AS00156 | DOI-USGS1 | 363537 | 363537 | yes | 5 | 5 | yes |
| O-BJA-2026-172697 | USDOJ-OJP-BJA | 363629 | 363629 | yes | 0 | 0 | yes |
| DE-FOA-0003215 | DOE-NETL | 363594 | 363594 | yes | 2 | 2 | yes |
| NOFOAFRLAFOSR20260001 | DOD-AFOSR | 363374 | 363374 | yes | 2 | 2 | yes |
| FA-NOFO0027-001 | DOI-BLM | 363101 | 363101 | yes | 0 | 0 | yes |
| P26AS00146 | DOI-NPS | 362717 | 362717 | yes | 3 | 3 | yes |
| DE-FOA-0003647 | DOE-GFO | 363815 | 363815 | yes | 0 | 0 | yes |
| USDA-NIFA-SLBCD-012281 | USDA-NIFA | 363784 | 363784 | yes | 1 | 1 | yes |
| N00244-26-S-NPS-F001 | DOD-ONR-SUP | 361099 | 361099 | yes | 4 | 4 | no |
| FR-RLD-26-001 | DOT-FRA | 363798 | 363798 | yes | 0 | 0 | yes |
| HHS-2026-ACF-OFVPS-EV-0010 | HHS-ACF-OFVPS | 362377 | 362377 | yes | 1 | 1 | yes |
| DE-FOA-0002265 | DOE-ID | 329436 | 329436 | yes | 5 | 5 | yes |
| N0001425SB001 | DOD-ONR | 356605 | 356605 | yes | 9 | 9 | no |
| DFOP0017890 | DOS-GHSD | 363649 | 363649 | yes | 10 | 10 | no |
| PDR-2600-DC-0USP | HUD | 362364 | 362364 | yes | 2 | 2 | no |
| W911NF-20-S-0008 | DOD-AMC | 325932 | 325932 | yes | 14 | 14 | yes |
| CDC-RFA-JG-26-0043 | HHS-CDC-GHC | 360332 | 360332 | yes | 1 | 1 | yes |
| NOAA-NMFS-AK-2026-33268 | DOC-DOCNOAAERA | 362034 | 362034 | yes | 1 | 1 | no |
| R26AS00052 | DOI-BOR | 363375 | 363375 | yes | 5 | 5 | no |
| W9126G262RFP1011 | DOD-COE-FW | 363673 | 363673 | yes | 2 | 2 | yes |
| HHS-2026-ACF-ORR-RP-0007 | HHS-ACF-ORR | 362962 | 362962 | yes | 2 | 2 | yes |
| FTA-2026-004-TRI | DOT-FTA | 363372 | 363372 | yes | 2 | 2 | yes |

## 3. `description` — the synopsis fallback's real coverage

`noticeText()` falls back to `synopsisSections(notice.description)`; `description` holds Simpler's `summary_description`, which is HTML. Both lengths are reported because the extractor reads the text, not the markup.

| family | posted rows | non-empty | share non-empty | raw chars p10 | raw median | raw p90 | text median | text < 500 chars |
|---|---|---|---|---|---|---|---|---|
| other_federal | 270 | 270 | 100.0 % | 293.6 | 942 | 2822.9 | 941.5 | 62 |
| nsf | 91 | 91 | 100.0 % | 804 | 1671 | 4032 | 1667 | 1 |
| dod_cdmrp | 81 | 81 | 100.0 % | 753 | 1313 | 1620 | 1310 | 1 |
| dod_other | 55 | 55 | 100.0 % | 193.6 | 1135 | 3030.6 | 1133 | 15 |
| hhs_other | 26 | 26 | 100.0 % | 759.5 | 1077.5 | 2093.5 | 1077.5 | 1 |
| doe | 13 | 13 | 100.0 % | 471.8 | 1316 | 7992.4 | 1315 | 2 |

| Metric | Value |
|---|---|
| posted non-NIH rows | 536 |
| with a non-empty `description` | 536 (100.0 %) |
| stripped text, median chars | 1167 |
| stripped text under 500 chars | 82 (15.3 %) |
| stripped text under 1,000 chars | 232 (43.3 %) |

## 4. NSF — which route reaches the solicitation

**This section reverses what the plan originally instructed**, and the order below reflects the finding rather than the original expectation. The plan said to derive a PDF URL from `opportunity_number` and to ignore `additional_info_url` because it "resolves to the wrong document". Measured, the opposite holds: the stored `additional_info_url` redirects to a complete HTML solicitation, and the derived PDF 404s for every 2025–26 publication. Both are still probed here — § 4a is the route to use, § 4b is the fallback and the evidence for not relying on it.

The earlier wrong-document claim came from a **constructed** `ods_key`. This script never constructs one: § 4a follows the URL the row stores, and a row without one is reported as unresolvable rather than guessed at.

| Metric | Value |
|---|---|
| NSF posted rows | 91 |
| `opportunity_number` matches `NN-NNN` (a solicitation) | 75 (82.4 %) |
| `PD-…` program descriptions (§ 4c — a separate case, not a miss) | 16 (17.6 %) |

### 4a. The stored `additional_info_url` → the HTML solicitation on `www.nsf.gov` — **the route to use**

The URL is taken from the row (`raw_payload_json.summary.additional_info_url`) when it is on an `*.nsf.gov` host, and from nowhere else. Redirects are followed to the final page, which is then tested for the section skeleton NON_NIH_FEASIBILITY § 6 maps to roles. A landing page reached this way is HTML, so **a solicitation recovered by this route needs no PDF extraction** — which is what takes NSF out of D66's scope.

| Metric | Value |
|---|---|
| NSF posted rows | 91 |
| carrying an `*.nsf.gov` `additional_info_url` | 91 (100.0 %) |
| carrying none — unresolvable, never guessed at | 0 |

| Metric | Value |
|---|---|
| pages fetched | 91 |
| HTTP 200 | 91 (100.0 %) |
| final URL ends `/solicitation` | 75 (82.4 % of 200s) |
| carries `II. Program Description` (the `objectives` role) | 75 (82.4 % of 200s) |
| median page bytes | 123363 |

| row kind | fetched | carries `II. Program Description` | rate |
|---|---|---|---|
| `NN-NNN` (a solicitation) | 75 | 75 | 100.0 % |
| `PD-…` (a program description, not a solicitation) | 16 | 0 | 0.0 % |

The `PD-` rows are NSF **program descriptions**, not solicitations: they land on a program page with no `I.–IX.` skeleton and no PDF. They are a distinct acquisition case, and the solicitation rate should be read off the first line alone.

Roles recoverable from the landing page (`NN-NNN` rows only):

| heading | pages carrying it | share of solicitation rows |
|---|---|---|
| I. Introduction (`purpose`) | 75 | 100.0 % |
| II. Program Description (`objectives`) | 75 | 100.0 % |
| III. Award Information (`award_info`) | 75 | 100.0 % |
| IV. Eligibility Information (`eligibility`) | 75 | 100.0 % |
| VI. Review Procedures (`review`) | 75 | 100.0 % |
| VIII. Agency Contacts (`contacts`) | 75 | 100.0 % |

| opportunity_number | HTTP | final URL | roles found |
|---|---|---|---|
| 20-544 | 200 | https://www.nsf.gov/funding/opportunities/expeditions-expeditions-computing/nsf20-544/solicitation | 6 |
| 20-558 | 200 | https://www.nsf.gov/funding/opportunities/pfe-rief-pfe-research-initiation-engineering-formation/nsf | 6 |
| 20-597 | 200 | https://www.nsf.gov/funding/opportunities/ddrig-arctic-doctoral-dissertation-research-improvement-gr | 6 |
| 21-588 | 200 | https://www.nsf.gov/funding/opportunities/ecrcore-edu-core-research/nsf21-588/solicitation | 6 |
| 21-595 | 200 | https://www.nsf.gov/funding/opportunities/tcup-tribal-colleges-universities-program/nsf21-595/solici | 6 |
| 22-586 | 200 | https://www.nsf.gov/funding/opportunities/career-faculty-early-career-development-program/nsf22-586/ | 6 |
| 22-600 | 200 | https://www.nsf.gov/funding/opportunities/dmsnigms-joint-dmsnigms-initiative-support-research-interf | 6 |
| 22-603 | 200 | https://www.nsf.gov/funding/opportunities/mca-mid-career-advancement/nsf22-603/solicitation | 6 |
| 22-605 | 200 | https://www.nsf.gov/funding/opportunities/che-drp-division-chemistry-disciplinary-research-programs/ | 6 |
| 22-615 | 200 | https://www.nsf.gov/funding/opportunities/dli-del-nsf-dynamic-language-infrastructure-neh-documentin | 6 |
| 22-621 | 200 | https://www.nsf.gov/funding/opportunities/aapf-nsf-astronomy-astrophysics-postdoctoral-fellowships/n | 6 |
| 22-624 | 200 | https://www.nsf.gov/funding/opportunities/mps-astro-mps-astronomical-sciences-research-programs/nsf2 | 6 |
| 22-627 | 200 | https://www.nsf.gov/funding/opportunities/ati-advanced-technologies-instrumentation-astronomical-sci | 6 |
| 23-500 | 200 | https://www.nsf.gov/funding/opportunities/sprf-sbe-postdoctoral-research-fellowships/nsf23-500/solic | 6 |
| 23-519 | 200 | https://www.nsf.gov/funding/opportunities/mri-major-research-instrumentation-program/nsf23-519/solic | 6 |
| 23-520 | 200 | https://www.nsf.gov/funding/opportunities/training-based-workforce-development-advanced/nsf23-520/so | 6 |
| 23-525 | 200 | https://www.nsf.gov/funding/opportunities/oceanographic-facilities-equipment-support/nsf23-525/solic | 6 |
| 23-563 | 200 | https://www.nsf.gov/funding/opportunities/hbcu-historically-black-colleges-universities-undergraduat | 6 |
| 23-566 | 200 | https://www.nsf.gov/funding/opportunities/arch-sr-archaeology-program-senior-research-awards/nsf23-5 | 6 |
| 23-569 | 200 | https://www.nsf.gov/funding/opportunities/sosbio-science-science-approach-analyzing-innovating-biome | 6 |

The derived-PDF fallback is measured on the same corpus in § 4b, and the two are directly comparable: every row this route resolves to a solicitation page carrying `II. Program Description` is a row PR 5.4 can section without touching a PDF, whatever § 4b returns for it.

### 4b. The derived `nsf-gov-resources.nsf.gov` PDF — fallback only

| Metric | Value |
|---|---|
| URLs probed | 75 |
| HTTP 200 | 34 (45.3 %) |
| 200 and `application/pdf` | 34 (45.3 %) |
| median content-length, bytes | 901133.5 |

| HTTP | count |
|---|---|
| 404 | 41 |
| 200 | 34 |

Misses:

| opportunity_number | URL | HTTP |
|---|---|---|
| 24-564 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24564/nsf24564.pdf | 404 |
| 24-569 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24569/nsf24569.pdf | 404 |
| 24-573 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24573/nsf24573.pdf | 404 |
| 24-584 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24584/nsf24584.pdf | 404 |
| 24-586 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24586/nsf24586.pdf | 404 |
| 24-587 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24587/nsf24587.pdf | 404 |
| 24-590 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24590/nsf24590.pdf | 404 |
| 24-597 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24597/nsf24597.pdf | 404 |
| 24-598 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24598/nsf24598.pdf | 404 |
| 25-510 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25510/nsf25510.pdf | 404 |
| 25-514 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25514/nsf25514.pdf | 404 |
| 25-515 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25515/nsf25515.pdf | 404 |
| 25-522 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25522/nsf25522.pdf | 404 |
| 25-523 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25523/nsf25523.pdf | 404 |
| 25-525 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25525/nsf25525.pdf | 404 |
| 25-526 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25526/nsf25526.pdf | 404 |
| 25-531 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25531/nsf25531.pdf | 404 |
| 25-533 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25533/nsf25533.pdf | 404 |
| 25-540 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25540/nsf25540.pdf | 404 |
| 25-543 | https://nsf-gov-resources.nsf.gov/solicitations/pubs/2025/nsf25543/nsf25543.pdf | 404 |

### 4c. `PD-` program descriptions — a separate acquisition case, not NSF misses

These rows are NSF **program descriptions**: a standing description of what a division funds, not a solicitation with deadlines and a review process. They carry no `I.–IX.` skeleton and no PDF, so neither route can reach a solicitation for them — because there is not one. They are counted here rather than inside either route's hit-rate, and PR 5.4 should let them fall through to the synopsis path instead of retrying them.

| opportunity_number | title | stored `additional_info_url` |
|---|---|---|
| PD-16-1266 | Applied Mathematics | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5664 |
| PD-16-1271 | Computational Mathematics | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5390 |
| PD-18-1263 | Probability | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5555 |
| PD-18-1268 | Foundations | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5548 |
| PD-18-1269 | Statistics | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5556 |
| PD-18-7970 | Combinatorics | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=503570 |
| PD-20-1260 | Mathematical Sciences Infrastructure Program | http://www.nsf.gov/publications/pub_summ.jsp?ods_key=201260 |
| PD-20-1264 | Algebra and Number Theory | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5431 |
| PD-20-1281 | Analysis | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5434 |
| PD-22-1265 | Geometric Analysis | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5549 |
| PD-22-1267 | Topology | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5551 |
| PD-22-7334 | Mathematical Biology | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5690 |
| PD-23-1242 | Plasma Physics | http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=503252 |
| PD-24-110Z | ECosystem for Leading Innovation in Plasma Science and Engineering (EC | http://www.nsf.gov/publications/pub_summ.jsp?ods_key=24110Z |
| PD-25-275Y | The Research on Research Security Program (RoRS) | http://www.nsf.gov/publications/pub_summ.jsp?ods_key=25275Y |
| PD-26-366Y | Transport Phenomena (TP) | http://www.nsf.gov/publications/pub_summ.jsp?ods_key=26366Y |

16 of the 91 posted NSF rows. Two URL shapes appear among them — `pub_summ.jsp?ods_key=<NNNNNN>` (no `nsf` prefix, unlike a solicitation's key) and the older `pgm_summ.jsp?pims_id=<N>` — which is a further reason not to construct keys.

## 5. CDMRP / DOD-AMRAA — FON shape, the `_GG.pdf` route, and the mechanism mix

| Metric | Value |
|---|---|
| DOD-AMRAA / CDMRP posted rows | 81 |
| matches `HT####YY<PROGRAM><MECHANISM>` | 79 (97.5 %) |
| matches the legacy `W81XWH-YY-…` shape | 1 |
| neither | 1 |

### 5a. Mechanism suffix distribution — known-wrong, kept only as a shape check

**Do not build on this table.** The suffix match below is wrong in both directions and is not being fixed here: `PCTA` is `P` + `CTA` mis-bound, `AZRPTRCA` is `AZRP` + `TRCA`, and the unmatched bucket is not a residue of rare mechanisms but of programs whose abbreviation the regex ate. It is printed only to show the rough shape of the distribution. § 5b is the input PR 5.5 uses.

| mechanism suffix | notices | example programs |
|---|---|---|
| (unmatched) | 26 | SBAA1, ALSRPCOBA, ALSRPTDA, ALSRPTIA |
| PCTA | 10 | ALSRP, AR, OCR, PRCR |
| IIRA | 8 | BMFRP, NFRP, OCRP, PRP |
| TRA | 8 | ATRP, CRRP, DMDRPC, SCIRPC |
| IDA | 7 | ARP, BMFRP, DMDRP, KCRP |
| RA | 6 | AZRPTR, HRRPF, MRPS, ORPA |
| CRA | 4 | ATRP, MBRPP, ORP, VRPM |
| CDA | 2 | ARP, RCRPR |
| ARM | 1 | MRPFP |
| DRA | 1 | TBDRPT |
| IPA | 1 | PRCRP |
| PA | 1 | OCRP |
| RPA | 1 | PCARPT |
| SIA | 1 | NFRP |
| TSA | 1 | MRP |
| TTDA | 1 | MBRP |

### 5b. Raw FON tails, verbatim — PR 5.5's input

**This table, not § 5a, is the deliverable.** § 5a's suffix match is known to be wrong in both directions — `PCTA ×10` is `P` + `CTA` mis-bound and `AZRPTRCA` is `AZRP` + `TRCA` — because CDMRP program abbreviations vary in length and no suffix regex can cut them correctly. PR 5.5 seeds the **program** set from CDMRP's published program list and takes the remainder as the mechanism; these are the strings it cuts. Every row is listed, uncollapsed.

| opportunity_number | FON tail | office+FY prefix |
|---|---|---|
| HT942526ALSRPCOBA | ALSRPCOBA | HT942526 |
| HT942526ALSRPPCTA | ALSRPPCTA | HT942526 |
| HT942526ALSRPTDA | ALSRPTDA | HT942526 |
| HT942526ALSRPTIA | ALSRPTIA | HT942526 |
| HT942526ARPCDA | ARPCDA | HT942526 |
| HT942526ARPCTA | ARPCTA | HT942526 |
| HT942526ARPIDA | ARPIDA | HT942526 |
| HT942526ATRPCRA | ATRPCRA | HT942526 |
| HT942526ATRPTRA | ATRPTRA | HT942526 |
| HT942526AZRPTRCA | AZRPTRCA | HT942526 |
| HT942526AZRPTRDA | AZRPTRDA | HT942526 |
| HT942526AZRPTRRA | AZRPTRRA | HT942526 |
| HT942526BCRPBTA122 | BCRPBTA122 | HT942526 |
| HT942526BCRPBTA3 | BCRPBTA3 | HT942526 |
| HT942526BCRPBTA4 | BCRPBTA4 | HT942526 |
| HT942526BCRPCREA2 | BCRPCREA2 | HT942526 |
| HT942526BCRPTBCCA | BCRPTBCCA | HT942526 |
| HT942526BMFRPIDA | BMFRPIDA | HT942526 |
| HT942526BMFRPIIRA | BMFRPIIRA | HT942526 |
| HT942526BMFRPRDA | BMFRPRDA | HT942526 |
| HT942526CRRPTRA | CRRPTRA | HT942526 |
| HT942526DMDRPCTRA | DMDRPCTRA | HT942526 |
| HT942526DMDRPIDA | DMDRPIDA | HT942526 |
| HT942526HRRPFRA | HRRPFRA | HT942526 |
| HT942526JWMRPMMRDA | JWMRPMMRDA | HT942526 |
| HT942526KCRPAKCIECSA | KCRPAKCIECSA | HT942526 |
| HT942526KCRPIDA | KCRPIDA | HT942526 |
| HT942526MBRPDA | MBRPDA | HT942526 |
| HT942526MBRPPCRA | MBRPPCRA | HT942526 |
| HT942526MBRPTTDA | MBRPTTDA | HT942526 |
| HT942526MRPFPARM | MRPFPARM | HT942526 |
| HT942526MRPIA | MRPIA | HT942526 |
| HT942526MRPMASA | MRPMASA | HT942526 |
| HT942526MRPSRA | MRPSRA | HT942526 |
| HT942526MRPTSA | MRPTSA | HT942526 |
| HT942526NFRPEHDA | NFRPEHDA | HT942526 |
| HT942526NFRPIIRA | NFRPIIRA | HT942526 |
| HT942526NFRPNFRALA | NFRPNFRALA | HT942526 |
| HT942526NFRPNFRASA | NFRPNFRASA | HT942526 |
| HT942526NFRPSIA | NFRPSIA | HT942526 |
| HT942526OCRPCTA | OCRPCTA | HT942526 |
| HT942526OCRPIIRA | OCRPIIRA | HT942526 |
| HT942526OCRPOCAECI | OCRPOCAECI | HT942526 |
| HT942526OCRPOCCTAECI | OCRPOCCTAECI | HT942526 |
| HT942526OCRPPA | OCRPPA | HT942526 |
| HT942526ORPARA | ORPARA | HT942526 |
| HT942526ORPCRA | ORPCRA | HT942526 |
| HT942526PCARPFPTA | PCARPFPTA | HT942526 |
| HT942526PCARPIDA | PCARPIDA | HT942526 |
| HT942526PCARPTRPA | PCARPTRPA | HT942526 |
| HT942526PRCRPCTA | PRCRPCTA | HT942526 |
| HT942526PRCRPIA | PRCRPIA | HT942526 |
| HT942526PRCRPIPA | PRCRPIPA | HT942526 |
| HT942526PRMRPCTA | PRMRPCTA | HT942526 |
| HT942526PRMRPPCTA | PRMRPPCTA | HT942526 |
| HT942526PRPEIRA | PRPEIRA | HT942526 |
| HT942526PRPIIRA | PRPIIRA | HT942526 |
| HT942526RCRPCA | RCRPCA | HT942526 |
| HT942526RCRPIDA | RCRPIDA | HT942526 |
| HT942526RCRPRCDA | RCRPRCDA | HT942526 |
| HT942526RTRPCA | RTRPCA | HT942526 |
| HT942526RTRPIIRA | RTRPIIRA | HT942526 |
| HT942523SBAA1 | SBAA1 | HT942523 |
| HT942526SCIRPCTA | SCIRPCTA | HT942526 |
| HT942526SCIRPCTRA | SCIRPCTRA | HT942526 |
| HT942526SCIRPIIRA | SCIRPIIRA | HT942526 |
| HT942526SCIRPTRA | SCIRPTRA | HT942526 |
| HT942526TBDRPIDA | TBDRPIDA | HT942526 |
| HT942526TBDRPTDRA | TBDRPTDRA | HT942526 |
| HT942526TBIPHRPCTA | TBIPHRPCTA | HT942526 |
| HT942526TBIPHRPHSRA | TBIPHRPHSRA | HT942526 |
| HT942526TBIPHRPTRA | TBIPHRPTRA | HT942526 |
| HT942526TERPCTA | TERPCTA | HT942526 |
| HT942526TERPIIRA | TERPIIRA | HT942526 |
| HT942526TERPTRA | TERPTRA | HT942526 |
| HT942526VRPCTA | VRPCTA | HT942526 |
| HT942526VRPIIRA | VRPIIRA | HT942526 |
| HT942526VRPMCRA | VRPMCRA | HT942526 |
| HT942526VRPTRA | VRPTRA | HT942526 |

79 modern FONs listed above; 2 row(s) do not match that shape:

| opportunity_number | title |
|---|---|
| HT9425-23-S-SOC1 | BROAD AGENCY ANNOUNCEMENT (BAA) for Extramural Biomedical and Human Pe |
| W81XWH-22-DHAPP | Department of Defense HIV/AIDS Prevention Program |

### 5c. `https://cdmrp.health.mil/funding/pa/{FON}_GG.pdf`

| Metric | Value |
|---|---|
| URLs probed | 79 |
| HTTP 200 | 68 (86.1 %) |
| 200 and `application/pdf` | 68 (86.1 %) |
| median content-length, bytes | 745333 |

| HTTP | count |
|---|---|
| 200 | 68 |
| 404 | 11 |

Misses:

| opportunity_number | URL | HTTP |
|---|---|---|
| HT942523SBAA1 | https://cdmrp.health.mil/funding/pa/HT942523SBAA1_GG.pdf | 404 |
| HT942526DMDRPCTRA | https://cdmrp.health.mil/funding/pa/HT942526DMDRPCTRA_GG.pdf | 404 |
| HT942526DMDRPIDA | https://cdmrp.health.mil/funding/pa/HT942526DMDRPIDA_GG.pdf | 404 |
| HT942526MRPFPARM | https://cdmrp.health.mil/funding/pa/HT942526MRPFPARM_GG.pdf | 404 |
| HT942526NFRPEHDA | https://cdmrp.health.mil/funding/pa/HT942526NFRPEHDA_GG.pdf | 404 |
| HT942526NFRPIIRA | https://cdmrp.health.mil/funding/pa/HT942526NFRPIIRA_GG.pdf | 404 |
| HT942526NFRPNFRALA | https://cdmrp.health.mil/funding/pa/HT942526NFRPNFRALA_GG.pdf | 404 |
| HT942526RTRPCA | https://cdmrp.health.mil/funding/pa/HT942526RTRPCA_GG.pdf | 404 |
| HT942526TBIPHRPCTA | https://cdmrp.health.mil/funding/pa/HT942526TBIPHRPCTA_GG.pdf | 404 |
| HT942526TBIPHRPHSRA | https://cdmrp.health.mil/funding/pa/HT942526TBIPHRPHSRA_GG.pdf | 404 |
| HT942526TBIPHRPTRA | https://cdmrp.health.mil/funding/pa/HT942526TBIPHRPTRA_GG.pdf | 404 |

Of the probed rows, **74** also carry a `_GG*.pdf` Simpler attachment (the mirror NON_NIH_FEASIBILITY § 5 predicts), among those § 2 probed.

## 6. RePORTER coverage of the HHS siblings (`RFA-HS/CE/DP/OH/IP-`)

| Metric | Value |
|---|---|
| open notices with a sibling prefix | 34 |
| — posted | 8 |
| — `normalizeAnnouncementNumber()` accepts the number | 34 |

| prefix | open | posted |
|---|---|---|
| RFA-HS- | 0 | 0 |
| RFA-CE- | 7 | 1 |
| RFA-DP- | 4 | 1 |
| RFA-OH- | 20 | 5 |
| RFA-IP- | 3 | 1 |

| Metric | Value |
|---|---|
| notices asked | 34 |
| request failed | 0 |
| ≥ 5 distinct projects | 4 / 34 (11.8 %) |
| ≥ 1 project | 5 / 34 |
| median distinct projects | 0 |

By prefix:

| prefix | asked | ≥ 5 projects | ≥ 1 project |
|---|---|---|---|
| RFA-HS- | 0 | 0 | 0 |
| RFA-CE- | 7 | 0 | 0 |
| RFA-DP- | 4 | 0 | 0 |
| RFA-OH- | 20 | 4 | 5 |
| RFA-IP- | 3 | 0 | 0 |

| opportunity_number | agency_code | distinct projects | award-years (meta.total) | error |
|---|---|---|---|---|
| RFA-CE-18-000 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-CE-27-013 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-CE-27-014 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-CE-27-015 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-CE-27-016 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-CE-27-017 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-CE-27-019 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-DP-18-000 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-DP-27-030 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-DP-27-036 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-DP-27-051 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-IP-18-000 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-IP-27-026 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-IP-27-035 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-22-005 | HHS-CDC-HHSCDCERA | 21 | 23 | — |
| RFA-OH-22-006 | HHS-CDC-HHSCDCERA | 16 | 22 | — |
| RFA-OH-24-001 | HHS-CDC-HHSCDCERA | 2 | 9 | — |
| RFA-OH-25-002 | HHS-CDC-HHSCDCERA | 15 | 40 | — |
| RFA-OH-25-003 | HHS-CDC-HHSCDCERA | 29 | 65 | — |
| RFA-OH-27-031 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-032 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-033 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-034 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-041 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-042 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-044 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-045 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-047 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-048 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-049 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-050 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-054 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-056 | HHS-CDC-HHSCDCERA | 0 | 0 | — |
| RFA-OH-27-078 | HHS-CDC-HHSCDCERA | 0 | 0 | — |

## 7. Admission, not exclusion — the material for D67

**Nothing in this section is a proposed corpus filter, and none is implied by any number in it.** Prospera serves multiple communities off one shared notice table (ImmunoX today, Global Health Sciences next), so no funder, subject or assistance listing is out of scope a priori: a USDA nutrition notice or a DOT road-traffic-injury notice is a real lead for a global-health investigator and noise for an immunologist, and it is the same row (NON_NIH_FEASIBILITY § 1). Relevance is a property of the **pair**, and belongs where the engine already lives.

What is measured here is the other thing D67 asks: **eligibility facts**, which are not subject-matter facts. A notice a university cannot hold — one that admits only individuals or state governments, or that is a procurement action rather than an assistance award — should be removed at stage 1 by `eligibility()` with a stated reason (E = 0), not filtered out of the corpus and not silently scored. NON_NIH_FEASIBILITY § 7.3 asks for the size of that set before anything is adopted; § 7c is that number.

### 7a. `applicant_types` across the posted non-NIH set

| applicant type | notices | share of the 536 |
|---|---|---|
| other | 292 | 54.5 % |
| unrestricted | 155 | 28.9 % |
| nonprofits_non_higher_education_with_501c3 | 111 | 20.7 % |
| state_governments | 105 | 19.6 % |
| federally_recognized_native_american_tribal_governments | 103 | 19.2 % |
| public_and_state_institutions_of_higher_education | 91 | 17.0 % |
| county_governments | 88 | 16.4 % |
| city_or_township_governments | 87 | 16.2 % |
| private_institutions_of_higher_education | 83 | 15.5 % |
| nonprofits_non_higher_education_without_501c3 | 67 | 12.5 % |
| other_native_american_tribal_organizations | 67 | 12.5 % |
| special_district_governments | 65 | 12.1 % |
| for_profit_organizations_other_than_small_businesses | 41 | 7.6 % |
| small_businesses | 40 | 7.5 % |
| independent_school_districts | 38 | 7.1 % |
| public_and_indian_housing_authorities | 32 | 6.0 % |
| individuals | 16 | 3.0 % |

| Metric | Value |
|---|---|
| rows with an empty `applicant_types` | 0 |
| admits an institution of higher education | 92 |
| admits a non-profit | 112 |
| carries `unrestricted` | 155 |
| carries `other` (defers to the announcement) | 292 |
| carries `individuals` | 16 |

### 7b. `funding_instrument` across the posted non-NIH set

| instrument | notices | share of the 536 |
|---|---|---|
| grant | 402 | 75.0 % |
| cooperative_agreement | 189 | 35.3 % |
| other | 38 | 7.1 % |
| procurement_contract | 24 | 4.5 % |

The combinations as stored:

| `funding_instrument` | notices |
|---|---|
| grant | 332 |
| cooperative_agreement | 115 |
| cooperative_agreement, grant | 44 |
| cooperative_agreement, grant, other, procurement_contract | 12 |
| other | 12 |
| grant, cooperative_agreement | 4 |
| cooperative_agreement, other, procurement_contract | 3 |
| cooperative_agreement, other | 2 |
| procurement_contract | 2 |
| cooperative_agreement, grant, other | 1 |
| cooperative_agreement, grant, procurement_contract | 1 |
| cooperative_agreement, grant, procurement_contract, other | 1 |
| grant, other | 1 |
| other, cooperative_agreement, grant | 1 |
| other, cooperative_agreement, grant, procurement_contract | 1 |
| other, grant, cooperative_agreement, procurement_contract | 1 |
| other, procurement_contract, cooperative_agreement, grant | 1 |
| other, procurement_contract, grant, cooperative_agreement | 1 |
| procurement_contract, grant, cooperative_agreement, other | 1 |

| instrument named in feasibility § 7.3 | notices carrying it |
|---|---|
| procurement_contract | 24 |
| formula_grant | 0 |
| direct_payment_for_specified_use | 0 |
| direct_payment_with_unrestricted_use | 0 |
| insurance | 0 |
| loan | 0 |
| loan_guarantee | 0 |

Not present in this corpus: `formula_grant`, `direct_payment_for_specified_use`, `direct_payment_with_unrestricted_use`, `insurance`, `loan`, `loan_guarantee`.

### 7c. What a stage-1 eligibility rule would remove — measured, not adopted

| Metric | Value |
|---|---|
| posted non-NIH rows | 536 |
| admits neither an IHE, a non-profit, `unrestricted` nor `other` | 21 (3.9 %) |
| no `grant` or `cooperative_agreement` instrument | 14 (2.6 %) |
| **either** — the whole stage-1 candidate set | 35 (6.5 %) |
| …of which the notice is also individuals-only | 2 |

Every row in that set, so the reason can be checked one at a time — an eligibility fact should be legible as one:

| opportunity_number | agency_code | title | applicant_types | funding_instrument | why |
|---|---|---|---|---|---|
| 2025-NIST-CHIPS-CRDO-01 | DOC-NIST | CHIPS Research and Development Office (CRDO) Broad Agency An | other | other | not an assistance award |
| DE-FOA-0003612 | PAMS-SC | The Genesis Mission:  Transforming Science and Energy with A | unrestricted | other | not an assistance award |
| DE-FOA-0003617 | DOE-ID | Staff Support for Regional Engagement with the U.S. Departme | for_profit_organizations_other_than_small_businesses | cooperative_agreement | no IHE / non-profit |
| DE-FOA-0003646 | DOE-GFO | DE-FOA-0003646 Notice of Intent to Issue DE-FOA-0003647 Acce | unrestricted | other | not an assistance award |
| DE-FOA-0003662 | DOE-GFO | NOI: PROSPECT Program: Providing Opportunities for Specializ | unrestricted | other | not an assistance award |
| DE-FOA-0003671 | DOE-NETL | Request for Information - Gauging Investor Interest in the D | unrestricted | other | not an assistance award |
| DFOP0017042 | DOS-GTIP | Notice of Intent:  Program to End Modern Slavery FY 2025 | other | other | not an assistance award |
| DHS-26-GPD-159-00-99 | DHS-DHS | State Border Security Reinforcement Fund | state_governments | grant | no IHE / non-profit |
| EP-U3R-26-002 | HHS-OS-ASPR | Trauma Care Readiness and Coordination Cooperative Agreement | federally_recognized_native_american_tribal_governments | cooperative_agreement | no IHE / non-profit |
| F24AS00298 | DOI-FWS | F24AS00298 Cooperative Agriculture | individuals, small_businesses | cooperative_agreement | no IHE / non-profit |
| F25AS00332 | DOI-FWS | F25AS00332 Highlands Conservation Act – Competitive Funding  | state_governments | grant | no IHE / non-profit |
| F25AS00379 | DOI-FWS | F25AS00379 Highlands Conservation Act - Base Funding Round | state_governments | grant | no IHE / non-profit |
| F26AS00071 | DOI-FWS | F26AS00071 Cooperative Endangered Species Conservation Fund: | state_governments | grant | no IHE / non-profit |
| FA520922S0001 | DOD-AF347CS | US Army Combat Capabilities Development Command (DEVCOM) Ind | other | procurement_contract | not an assistance award |
| FA865125S0001 | DOD-AFRL-RW | Air Dominance Broad Agency Announcement (BAA) | unrestricted | other | not an assistance award |
| FA875024S7003 | DOD-AFRL | Coordinating Austere Nodes through Virtualization and Analys | other | other | not an assistance award |
| FHWA-ADCM-26-001 | DOT-FHWA | FY25 and FY26 Advanced Digital Construction Management Syste | state_governments | grant | no IHE / non-profit |
| FHWA-BOLL-26-001 | DOT-FHWA | FY26 - Stopping Threats On Pedestrian Competitive Grant Prog | state_governments, city_or_township_governments, county_governments | grant | no IHE / non-profit |
| FHWA-PROT-26-001 | DOT-FHWA | FYs 2024 through 2026 - Promoting Resilient Operations for T | county_governments, federally_recognized_native_american_tribal_governments, special_district_governments, state_governments, city_or_township_governments | grant | no IHE / non-profit |
| FM-MCG-27-001 | DOT-FMCSA | Development of Fiscal Year 2027 Commercial Vehicle Safety Pl | state_governments | grant | no IHE / non-profit |
| GR-RCE-25-001 | USDOT-GCR | RESTORE Act Centers of Excellence Research Grants Program | state_governments | grant | no IHE / non-profit |
| GR-RDC-25-001 | USDOT-GCR | RESTORE Act Direct Component – Construction and Real Propert | state_governments, county_governments | grant | no IHE / non-profit |
| GR-RDC-25-002 | USDOT-GCR | RESTORE Act Direct Component - Non-Construction Activities | state_governments, county_governments | grant | no IHE / non-profit |
| HT9425-23-S-SOC1 | DOD-AMRAA | BROAD AGENCY ANNOUNCEMENT (BAA) for Extramural Biomedical an | unrestricted | procurement_contract | not an assistance award |
| NAG-BASIC-FY27 | IMLS | Native American Library Services Basic Grant (2027) | federally_recognized_native_american_tribal_governments | grant | no IHE / non-profit |
| NAG-ENHANCEMENT-FY27 | IMLS | Native American Library Services Enhancement Grants (2027) | federally_recognized_native_american_tribal_governments | grant | no IHE / non-profit |
| O-BJA-2026-172675 | USDOJ-OJP-BJA | BJA FY 2026 Harold Rogers Prescription Drug Monitoring Progr | federally_recognized_native_american_tribal_governments, other_native_american_tribal_organizations, state_governments | grant | no IHE / non-profit |
| O-BJA-2026-172690 | USDOJ-OJP-BJA | BJA FY 2026 Byrne State Crisis Intervention Formula Program | state_governments | cooperative_agreement | no IHE / non-profit |
| O-BJA-2026-172704 | USDOJ-OJP-BJA | BJA FY 2026 Edward Byrne Memorial Justice Assistance Grant ( | state_governments | grant | no IHE / non-profit |
| O-OVC-2026-172695 | USDOJ-OJP-OVC | OVC FY 2026 Improving Outcomes for Child and Youth Victims o | state_governments, federally_recognized_native_american_tribal_governments | grant | no IHE / non-profit |
| OFOP0003410 | DOS-BIH | Strengthening Bosnia and Herzegovina’s Organized Crime Speci | individuals | grant | no IHE / non-profit |
| SFOP0007154 | DOS-GTIP | Notice of Intent on Upcoming 2020 TIP Office Funding Opportu | other | other | not an assistance award |
| SFOP0008547 | DOS-GTIP | Notice of Intent:  Program to End Modern Slavery FY 2022 | other | other | not an assistance award |
| SFOP0009339 | DOS-GTIP | Notice of Intent:  Program to End Modern Slavery FY 2023 | other | other | not an assistance award |
| W911QY25R0023 | DOD-AMC-ACCAPGN | US Army Combat Capabilities Development Command Broad Agency | other | other | not an assistance award |

| agency_code | rows in the stage-1 candidate set |
|---|---|
| DOI-FWS | 4 |
| DOS-GTIP | 4 |
| DOT-FHWA | 3 |
| USDOJ-OJP-BJA | 3 |
| USDOT-GCR | 3 |
| DOE-GFO | 2 |
| IMLS | 2 |
| DHS-DHS | 1 |
| DOC-NIST | 1 |
| DOD-AF347CS | 1 |
| DOD-AFRL | 1 |
| DOD-AFRL-RW | 1 |
| DOD-AMC-ACCAPGN | 1 |
| DOD-AMRAA | 1 |
| DOE-ID | 1 |
| DOE-NETL | 1 |
| DOS-BIH | 1 |
| DOT-FMCSA | 1 |
| HHS-OS-ASPR | 1 |
| PAMS-SC | 1 |
| USDOJ-OJP-OVC | 1 |

This is a count, not a recommendation. `applicant_types` is Simpler's coding of the announcement, not the announcement — the `other` and `unrestricted` rows in particular defer to text no one has read yet — so the rule these rows would justify has to be checked against the announcements before PR 5.6, and it belongs in `eligibility()` where E = 0 carries a stated reason, never in `loadCandidates`.

**The two halves are not equally trustworthy.** Of the 14 rows caught by the instrument test alone, these are the title shapes:

| title shape | rows |
|---|---|
| Notice of Intent / NOI | 6 |
| Broad Agency Announcement / BAA | 4 |
| none of these | 3 |
| Request for Information / RFI | 1 |

A Notice of Intent or an RFI is genuinely not something to apply for, and dropping it at stage 1 would be right. A **Broad Agency Announcement is not**: `HT9425-23-S-SOC1` — the DHA extramural biomedical BAA, `unrestricted` applicants, coded `procurement_contract` — is exactly the kind of notice a UCSF investigator should see, and so is `DE-FOA-0003612` (DOE Genesis Mission, coded `other`). So `funding_instrument` alone cannot carry a stage-1 exclusion; the applicant-type half of the rule is the sound one, and the instrument half needs the announcement text PR 5.3 will fetch before it can be used at all.

### 7d. Agency × assistance listing — descriptive context, **not a proposed filter**

Printed so a person can see what is actually in the corpus. No row here is a candidate for exclusion: the same USDA or DOT listing that is noise for one community is a lead for another (§ 7 preamble).

| agency_code | assistance listing | program title | notices | example titles |
|---|---|---|---|---|
| DOD-AMRAA | 12.420 | Military Medical Research and Development | 80 | “BROAD AGENCY ANNOUNCEMENT (BAA) for Extramural Biomedic” · “DOD Defense Health Agency (DHA) Research & Development ” · “DoW Amyotrophic Lateral Sclerosis Research Program, Cli” |
| NSF | 47.049 | Mathematical and Physical Sciences | 46 | “Faculty Early Career Development Program” · “Joint DMS/NIGMS Initiative to Support Research at the I” · “Division of Chemistry: Disciplinary Research Programs” |
| NSF | 47.076 | STEM Education (formerly Education and Human Resources) | 31 | “EDU Core Research” · “Tribal Colleges and Universities Program (TCUP)” · “Faculty Early Career Development Program” |
| NSF | 47.041 | Engineering | 29 | “PFE: Research Initiation in Engineering Formation (PFE:” · “Faculty Early Career Development Program” · “Major Research Instrumentation Program” |
| NSF | 47.070 | Computer and Information Science and Engineering | 27 | “Expeditions in Computing” · “Faculty Early Career Development Program” · “NSF Dynamic Language Infrastructure - NEH Documenting E” |
| NSF | 47.050 | Geosciences | 26 | “Arctic Doctoral Dissertation Research Improvement Grant” · “Faculty Early Career Development Program” · “Mid-Career Advancement” |
| NSF | 47.075 | Social, Behavioral, and Economic Sciences | 26 | “Faculty Early Career Development Program” · “Mid-Career Advancement” · “NSF Dynamic Language Infrastructure - NEH Documenting E” |
| NSF | 47.074 | Biological Sciences | 19 | “Faculty Early Career Development Program” · “Mid-Career Advancement” · “Major Research Instrumentation Program” |
| NSF | 47.084 | NSF Technology, Innovation, and Partnerships | 19 | “Faculty Early Career Development Program” · “Major Research Instrumentation Program” · “Historically Black Colleges and Universities - Excellen” |
| NSF | 47.083 | Integrative Activities | 14 | “Faculty Early Career Development Program” · “Mid-Career Advancement” · “Major Research Instrumentation Program” |
| DOS-GTIP | 19.019 | International Programs to Combat Human Trafficking | 13 | “Notice of Intent:  Program to End Modern Slavery FY 202” · “Program to End Modern Slavery Annual Program Statement” · “Program to End Modern Slavery Annual Program Statement” |
| NASA-HQ | 43.001 | Science | 12 | “ROSES25: A.13 Accelerating Earth Solutions” · “ROSES25: A.14 Atmosphere” · “ROSES25: A.15 Biosphere” |
| NSF | 47.079 | Office of International Science and Engineering | 11 | “Faculty Early Career Development Program” · “Major Research Instrumentation Program” · “Historically Black Colleges and Universities - Excellen” |
| DOS-GHSD | 19.029 | The U.S. President's Emergency Plan for AIDS Relief Programs | 10 | “Advancing Global Health” · “Advancing Global Health” · “Advancing Global Health” |
| DOD-AFRL | 12.800 | Air Force Defense Research Sciences Program | 9 | “Continuing Human Enabling Enhancing Restoring and Susta” · “CHEERS Open Period 1 - All Technical Areas” · “CHEERS Open Period 2 - All Technical Areas” |
| DOD-COE-FW | 12.005 | Conservation and Rehabilitation of Natural Resources on Military Installations | 9 | “Naval Base Kitsap-Bremerton Natural Resources Support- ” · “Conservation and Forestry Program Support (2026-2031) f” · “Groundwater and Surficial Water Salinity Changes in Eve” |
| HHS-CDC-GHC | 93.318 | Protecting and Improving Health Globally: Building and Strengthening Public Health Impact, Systems, Capacity and Security | 9 | “Improving global health security in Côte d'Ivoire to st” · “Expanding global health security through local partners” · “Expanding global health security through local partners” |
| DOD-AMC | 12.431 | Basic Scientific Research | 7 | “UNITED STATES MILITARY ACADEMY Broad Agency Announcemen” · “DEVCOM ARMY RESEARCH LABORATORY BROAD AGENCY ANNOUNCEME” · “DEVCOM ANALYSIS CENTER BROAD AGENCY ANNOUNCEMENT FOR AP” |
| DOC-DOCNOAAERA | 11.015 | Broad Agency Announcement | 6 | “FY 2024 – 2026 - Broad Agency Announcement (BAA) Announ” · “FY 2024 – 2026 Broad Agency Announcement (BAA), Nationa” · “FY 2024 – 2026 - Broad Agency Announcement (BAA) Announ” |
| DOD-ONR | 12.300 | Basic and Applied Scientific Research | 5 | “FY25 Long Range Broad Agency Announcement (BAA) for Nav” · “Special Program Announcement for Office of Naval Resear” · “Fiscal Year (FY) 2027 Department of the Navy (DoN) Hist” |
| DOI-USGS1 | 15.808 | U.S. Geological Survey Research and Data Collection | 5 | “Cooperative Agreement for Affiliated Partner with the H” · “Cooperative Agreement for Affiliated Partner with the A” · “Cooperative Agreement for Affiliated Partner with the C” |
| DOL-ILAB | 17.401 | International Labor Programs | 5 | “Supporting Implementation of the Labor Provisions of Tr” · “Protecting the American Seafood Supply Chain by Counter” · “Ensuring “Pro-American Worker” Critical Minerals Supply” |
| DOS-ECA | 19.415 | Professional and Cultural Exchange Programs - Citizen Exchanges | 5 | “Annual Program Statement for U.S. Presentation at Inter” · “Annual Program Statement for U.S. Presentation at Inter” · “Annual Program Statement for U.S. Presentation at Inter” |
| USDOJ-OJP-OVC | 16.320 | Services for Trafficking Victims | 5 | “OVC FY 2026 Housing Assistance for Victims of Human Tra” · “OVC FY 2026 Integrated Services for Minor Victims of Hu” · “OVC FY 2026 Improving Outcomes for Child and Youth Vict” |
| DOE-ID | 81.121 | Nuclear Energy Research, Development and Demonstration | 4 | “University Nuclear Leadership Program– Scholarship and ” · “Advanced Nuclear Energy Licensing Cost-Share Grant Prog” · “Staff Support for Regional Engagement with the U.S. Dep” |
| DOE-NETL | 81.089 | Fossil Energy Research and Development | 4 | “Annual Recurring University Training and Research” · “Improved Oil and Gas Recovery and Produced Water Manage” · “Advancing Oil and Natural Gas Production and Delivery” |
| DOS-AF | 19.989 | State/African Regional - Other Economic Support Funds (ESF) Projects/Programs | 4 | “U.S.-Africa Strategic Investment Program” · “U.S.-Africa Strategic Investment Program” · “U.S.-Africa Strategic Investment Program” |
| DOS-NEA | 19.600 | Bureau of Near Eastern Affairs | 4 | “NEA/AC Regional Annual Program Statement” · “NEA/AC Regional Annual Program Statement” · “NEA/AC Regional Annual Program Statement” |
| DOS-SAU | 19.040 | Public Diplomacy Programs | 4 | “AI Partnership & Exchange for Tech Leaders (APEX)” · “University-led Networks for Innovation, Technology, and” · “U.S-Saudi AI Research Commercialization Accelerator Pro” |
| NEA | 45.201 | Arts and Artifacts Indemnity | 4 | “NEA Arts and Artifacts International Indemnity Program ” · “NEA Arts and Artifacts International Indemnity Program ” · “NEA Arts and Artifacts Domestic Indemnity Program 1, FY” |
| USDOJ-OJP-BJA | 16.738 | Edward Byrne Memorial Justice Assistance Grant Program | 4 | “BJA FY 2026 Byrne State Crisis Intervention Formula Pro” · “BJA FY 2026 Local Law Enforcement Crime Gun Intelligenc” · “BJA FY 2026 Edward Byrne Memorial Justice Assistance Gr” |
| USDOJ-OJP-BJA | 16.812 | Second Chance Act Reentry Initiative | 4 | “BJA FY 2026 Smart Reentry Demonstration Program” · “BJA FY 2026 Public Safety and Mental Health Initiative” · “BJA FY 2026 Second Chance Act Improving Reentry Educati” |
| DOI-BLM | 15.232 | Joint Fire Science Program | 3 | “Department of Interior Wildland Fire Service BLM-Nation” · “U.S. Wildland Fire Service BLM-National Interagency Fir” · “U.S Wildland Fire Service BLM-National Interagency Fire” |
| DOI-FWS | 15.662 | Great Lakes Restoration | 3 | “F26AS00083 Aquatic Invasive Species Grants to Great Lak” · “F26AS00084 Aquatic Invasive Species Grants to Great Lak” · “F26AS00085 Aquatic Invasive Species Interjurisdictional” |
| ED | 84.305 | Education Research, Development and Dissemination | 3 | “Institute of Education Sciences (IES): National Center ” · “Institute of Education Sciences (IES): National Center ” · “Institute of Education Sciences (IES): National Center ” |
| IMLS | 45.301 | Museums for America | 3 | “Inspire Grants for Small Museums (2027)” · “Museums Empowered (2027)” · “Museums for America (2027)” |
| IMLS | 45.311 | Native American and Native Hawaiian Library Services | 3 | “Native American Library Services Basic Grant (2027)” · “Native American Library Services Enhancement Grants (20” · “Native Hawaiian Library Services Grants (2027)” |
| USDOJ-OJP-BJS | 16.734 | Special Data Collections and Statistical Studies | 3 | “BJS FY 2026 Annual Surveys of Probation and Parole (ASP” · “BJS FY 2026 National Incident-Based Reporting System Es” · “BJS FY 2026 Criminal History Record Assessment and Rese” |
| USDOT-GCR | 21.015 | Resources and Ecosystems Sustainability, Tourist Opportunities, and Revived Economies of the Gulf Coast States | 3 | “RESTORE Act Centers of Excellence Research Grants Progr” · “RESTORE Act Direct Component – Construction and Real Pr” · “RESTORE Act Direct Component - Non-Construction Activit” |
| DHS-DHS | 97.144 | Flood Mitigation Assistance (FMA) Swift Current | 2 | “Fiscal Year 2024 Flood Mitigation Assistance Swift Curr” · “Fiscal Year 2026 Flood Mitigation Assistance Swift Curr” |
| DOC-NIST | 11.042 | CHIPS Research and Development | 2 | “CHIPS Research and Development Office (CRDO) Broad Agen” · “Measurement Science and Engineering (MSE) Research Gran” |
| DOD-AFOSR | 12.431 | Basic Scientific Research | 2 | “FY26 DEFENSE ESTABLISHED PROGRAM TO STIMULATE COMPETITI” · “FY26 DEFENSE ESTABLISHED PROGRAM TO STIMULATE COMPETITI” |
| DOD-AFOSR | 12.800 | Air Force Defense Research Sciences Program | 2 | “Air Force Basic Research Sciences Conference and Worksh” · “Fiscal Year 2027 Defense University Research Instrument” |
| DOD-AFRL-RW | 12.800 | Air Force Defense Research Sciences Program | 2 | “Air Delivered Effects” · “Air Dominance Broad Agency Announcement (BAA)” |
| DOD-AMC | 12.630 | Basic, Applied, and Advanced Research in Science and Engineering | 2 | “UNITED STATES ARMY RESEARCH INSTITUTE FOR THE BEHAVIORA” · “Research and Education Program for Historically Black C” |
| DOD-DARPA-DSO | 12.910 | Research and Technology Development | 2 | “Defense Sciences Office (DSO) Office-wide BAA” · “Precision Inertial Navigation & Positioning On an Integ” |
| DOE-ARPAE | 81.135 | Advanced Research Projects Agency - Energy | 2 | “SPURRING PROJECTS TO ADVANCE ENERGY RESEARCH AND KNOWLE” · “SEEDING CRITICAL ADVANCES FOR LEADING ENERGY TECHNOLOGI” |
| DOE-GFO | 81.087 | Renewable Energy Research and Development | 2 | “DE-FOA-0003646 Notice of Intent to Issue DE-FOA-0003647” · “Accelerating Scale-up and Pre-piloting of Emerging Chem” |
| DOI-FWS | 15.608 | Fish and Aquatic Conservation - Aquatic Invasive Species | 2 | “F26AS00104 State ANS Management Plan 2026” · “FY2026 Implementation of the Quagga and Zebra Mussel Ac” |
| DOI-FWS | 15.667 | Highlands Conservation | 2 | “F25AS00332 Highlands Conservation Act – Competitive Fun” · “F25AS00379 Highlands Conservation Act - Base Funding Ro” |
| DOI-NPS | 15.916 | Outdoor Recreation Acquisition, Development and Planning | 2 | “Outdoor Recreation Legacy Partnership Program (ORLP) Re” · “Readiness and Recreation Initiative (RARI) – Recurring ” |
| DOL-ETA | 17.277 | WIOA National Dislocated Worker Grants / WIA National Emergency Grants | 2 | “Updated National Dislocated Worker Grant Program Guidan” · “Updated National Dislocated Worker Grant Program Guidan” |
| DOS-CA | 19.043 | Study of International Parental Child Abduction | 2 | “Effects of International Parental Child Abduction on Ab” · “Effects of International Parental Child Abduction on Ab” |
| DOS-DRL | 19.345 | International Programs to Support Democracy, Human Rights and Labor | 2 | “Emergency Assistance for Fundamental Freedom Defenders” · “Emergency Assistance for Fundamental Freedom Defenders” |
| DOS-INL | 19.705 | Trans-National Crime | 2 | “Kenya:  Crowd Control and Less-Than-Lethal Riot Respons” · “Logistical Support for Citizen Security, counternarcoti” |
| DOS-PAN | 19.040 | Public Diplomacy Programs | 2 | “Countering CCP Influence in Panama's Unviersities” · “Equipping Journalists to Counter Anti-American Propagan” |
| DOT-FTA | 20.526 | Buses and Bus Facilities Formula, Competitive, and Low or No Emissions Programs | 2 | “Fiscal Year 2026 Competitive Funding Opportunity: Buses” · “Fiscal Year 2026 Competitive Funding Opportunity: Low o” |
| ED | 84.324 | Research in Special Education | 2 | “Institute of Education Sciences (IES): National Center ” · “Institute of Education Sciences (IES): National Center ” |
| HHS-ACF-OFVPS | 93.592 | Family Violence Prevention and Services/Discretionary | 2 | “National Resource Centers” · “Specialized Services for Abused Parents and Their Child” |
| HHS-CDC-GHC | 93.067 | Global AIDS | 2 | “Ending HIV and TB as public health threats through an a” · “Strengthening Ghana Health Service laboratory services,” |
| IMLS | 45.312 | National Leadership Grants | 2 | “National Leadership Grants for Libraries (2027)” · “National Leadership Grants for Museums (2027)” |
| NSF | 93.859 | Biomedical Research and Research Training | 2 | “Joint DMS/NIGMS Initiative to Support Research at the I” · “A Science of Science Approach to Analyzing and Innovati” |
| PAMS-SC | 81.049 | Office of Science Financial Assistance Program | 2 | “FY 2026 Continuation of Solicitation for the Office of ” · “The Genesis Mission:  Transforming Science and Energy w” |
| USDA-APHIS | 10.031 | Plant Pest and Disease Management (PPDM) | 2 | “Plant Protection Act Section 7721 Fiscal Year 2027 Nati” · “Plant Protection Act Section 7721 Plant Pest and Diseas” |
| USDA-FS | 10.689 | Community Forest and Open Space Conservation Program (CFP) | 2 | “Community Forest and Open Space Conservation Program” · “Great Lakes Restoration Initiative: Community Forest an” |
| USDA-NIFA | 10.310 | Agriculture and Food Research Initiative (AFRI) | 2 | “Agriculture and Food Research Initiative Competitive Gr” · “Agriculture and Food Research Initiative Competitive Gr” |
| USDOJ-OJP-BJA | 16.076 | Law Enforcement Support for Combatting Criminal Aliens, Drug, and Human Trafficking | 2 | “OJP FY 2026 Special Attorneys Program Round 8” · “BJA FY 2026 Bridging Immigration-Related Deficits Exper” |
| USDOJ-OJP-BJA | 16.838 | Comprehensive Opioid, Stimulant, and other Substances Use Program | 2 | “BJA FY 2026 Public Safety and Mental Health Initiative” · “BJA FY 2026 Comprehensive Opioid, Stimulant, and Substa” |
| USDOJ-OJP-BJS | 16.554 | National Criminal History Improvement Program (NCHIP) | 2 | “BJS FY 2026 Consolidated National Criminal History Impr” · “BJS FY 2026 National Criminal History Improvement Progr” |
| AC | 94.002 | AmeriCorps Seniors Retired and Senior Volunteer Program (RSVP) 94.002 | 1 | “Fiscal Year (FY) 2027 AmeriCorps Seniors RSVP Competiti” |
| AC | 94.006 | AmeriCorps State and National 94.006 | 1 | “Fiscal Year (FY) 2027 AmeriCorps State and National Com” |
| DHS-DHS | 97.159 | State Border Security Reinforcement Fund | 1 | “State Border Security Reinforcement Fund” |
| DOC-DOCNISTERA | 11.029 | Tribal Broadband Connectivity Program | 1 | “Tribal Broadband Connectivity Program” |
| DOC-DOCNISTERA | 11.036 | Digital Equity Competitive Grant Program | 1 | “Native Entities Grant Program” |
| DOC-DOCNOAAERA | 11.058 | Bluefin Tuna Research Program | 1 | “SEFSC Bluefin Tuna Research Program” |
| DOC-DOCNOAAERA | 11.420 | Coastal Zone Management Estuarine Research Reserves | 1 | “National Estuarine Research Reserve System (NERRS) Land” |
| DOC-DOCNOAAERA | 11.452 | Unallied Industry Projects | 1 | “National Bycatch Reduction Engineering Program (BREP) -” |
| DOC-DOCNOAAERA | 11.455 | Marine Education | 1 | “2026 Alaska Marine Education and Training Mini-Grant Pr” |
| DOC-DOCNOAAERA | 11.463 | Habitat Conservation | 1 | “DARRP Restoration Implementation Grants (2026)” |
| DOC-NIST | 11.037 | CHIPS Incentives Program | 1 | “CHIPS Incentives Program – Facilities for Semiconductor” |
| DOC-NIST | 11.609 | Measurement and Engineering Research and Standards | 1 | “Measurement Science and Engineering (MSE) Research Gran” |
| DOC-NIST | 11.619 | Arrangements for Interdisciplinary Research Infrastructure | 1 | “Measurement Science and Engineering (MSE) Research Gran” |
| DOC-NIST | 11.620 | Science, Technology, Business and/or Education Outreach | 1 | “Measurement Science and Engineering (MSE) Research Gran” |
| DOC-NTIA | 11.038 | Public Wireless Supply Chain Innovation Fund Grant Program | 1 | “Public Wireless Supply Chain Innovation Fund Grant Prog” |
| DOD-AF347CS | 12.800 | Air Force Defense Research Sciences Program | 1 | “US Army Combat Capabilities Development Command (DEVCOM” |
| DOD-AFRL | 12.910 | Research and Technology Development | 1 | “Automated Processes for Knowledge Discovery and Informa” |
| DOD-AMC-ACCAPGN | 12.431 | Basic Scientific Research | 1 | “US Army Combat Capabilities Development Command Broad A” |
| DOD-AMRAA | 12.350 | Department of Defense HIV/AIDS Prevention Program | 1 | “Department of Defense HIV/AIDS Prevention Program” |
| DOD-COE-ERDC | 12.630 | Basic, Applied, and Advanced Research in Science and Engineering | 1 | “ERDC Broad Agency Announcement” |
| DOD-DARPA-BTO | 12.910 | Research and Technology Development | 1 | “Biological Technologies” |
| DOD-DARPA-IPTO | 12.910 | Research and Technology Development | 1 | “Information Processing Techniques Office Office-Wide” |
| DOD-DARPA-TTO | 12.910 | Research and Technology Development | 1 | “TTO Office Wide (OW) BAA 2025” |
| DOD-DTRA | 12.351 | Scientific Research - Combating Weapons of Mass Destruction | 1 | “Fundamental Research to Counter Weapons of Mass Destruc” |
| DOD-NGIA | 12.630 | Basic, Applied, and Advanced Research in Science and Engineering | 1 | “Boosting Innovative GEOINT - Science & Technology  Broa” |
| DOD-ONR-NRL | 12.300 | Basic and Applied Scientific Research | 1 | “NRL Long Range Broad Agency Announcement (BAA) for Basi” |
| DOD-ONR-SUP | 12.300 | Basic and Applied Scientific Research | 1 | “Research Initiatives at the Naval Postgraduate School” |
| DOD-WHS | 12.006 | National Defense Education Program | 1 | “NDEP STEM Open NFO” |
| DOD-WHS | 12.024 | Defense Security Cooperation University - Research Grants | 1 | “Defense Security Cooperation University - Research Gran” |
| DOD-WHS | 12.032 | Department of War Cyber Academic Engagement Office | 1 | “National Center for Narrative Intelligence (NCNI)” |
| DOD-WHS | 12.632 | Legacy Resource Management Program | 1 | “DoW’s Energy, Installations, and Environment Innovation” |
| DOD-WHS | 12.902 | Information Security Grants | 1 | “Department of War Cyber Service Academy (DoW CSA)” |
| DOE-GFO | 81.117 | Energy Efficiency and Renewable Energy Information Dissemination, Outreach, Training and Technical Analysis/Assistance | 1 | “NOI: PROSPECT Program: Providing Opportunities for Spec” |
| DOI-BLM | 15.230 | Invasive and Noxious Plant Management | 1 | “FY26 Bureau of Land Management Invasive and Noxious Pla” |
| DOI-BLM | 15.243 | Youth Conservation Opportunities on Public Lands | 1 | “FY26 Bureau of Land Management Youth Conservation Corps” |
| DOI-BLM | 15.245 | Plant Conservation and Restoration Management | 1 | “FY26 Bureau of Land Management Plant Conservation and R” |
| DOI-BLM | 15.246 | Threatened and Endangered Species | 1 | “FY26 Bureau of Land Management Threatened and Endangere” |
| DOI-BLM | 15.247 | Wildlife Resource Management | 1 | “FY26 Bureau of Land Management Wildlife Resource Manage” |
| DOI-BOR | 15.504 | Water Recycling and Desalination Construction Programs | 1 | “Title XVI Water Reclamation and Reuse Projects” |
| DOI-BOR | 15.506 | Water Desalination Research and Development | 1 | “Desalination and Water Purification Research Program: R” |
| DOI-BOR | 15.507 | WaterSMART (Sustain and Manage America’s Resources for Tomorrow) | 1 | “WaterSMART Enhancing Water Resources Projects” |
| DOI-BOR | 15.519 | Indian Tribal Water Resources Development, Management, and Protection | 1 | “Native American Affairs: Fiscal Year 2025 Colorado Rive” |
| DOI-BOR | 15.554 | Cooperative Watershed Management | 1 | “WaterSMART Cooperative Watershed Management Program” |
| DOI-BOR | 15.557 | Applied Science Grants | 1 | “WaterSMART: Applied Science Grants” |
| DOI-BOR | 15.591 | WaterSMART Desalination Construction Program | 1 | “WaterSMART: Desalination Construction Projects” |
| DOI-FWS | 15.615 | Cooperative Endangered Species Conservation Fund | 1 | “F26AS00071 Cooperative Endangered Species Conservation ” |
| DOI-FWS | 15.623 | North American Wetlands Conservation Fund | 1 | “F27AS00008-NAWCA 2027-1 US Standard Grants” |
| DOI-FWS | 15.630 | Coastal | 1 | “F26AS00069 Coastal Program FY26” |
| DOI-FWS | 15.631 | Partners for Fish and Wildlife | 1 | “F26AS00068 Partners for Fish and Wildlife FY26” |
| DOI-FWS | 15.634 | State Wildlife Grants | 1 | “F26AS00051_FY 2026 Competitive State Wildlife Grant (C-” |
| DOI-FWS | 15.681 | Cooperative Agriculture | 1 | “F24AS00298 Cooperative Agriculture” |
| DOI-FWS | 15.685 | National Fish Passage | 1 | “F26AS00105 National Fish Passage Program” |
| DOI-NPS | 15.928 | Battlefield Land Acquisition Grants | 1 | “FY2026 ABPP - Battlefield Land Acquisition Grant” |
| DOI-NPS | 15.930 | Chesapeake Bay Gateways Network | 1 | “Exploring and Enhancing Outdoor and Heritage Tourism in” |
| DOI-NPS | 15.945 | Cooperative Research and Training Programs ��� Resources of the National Park System | 1 | “NPS Cooperative Ecosystems Studies Units (CESU) Master ” |
| DOI-NPS | 15.963 | Southwest Border Resource Protection Program | 1 | “Southwest Border Resource Protection Program” |
| DOI-USGS1 | 15.805 | Assistance to State Water Resources Research Institutes | 1 | “FY2026 Water Resources Research Act Non-Competitive Coo” |
| DOL-ETA | 17.289 | Community Project Funding/Congressionally Directed Spending | 1 | “Training and Employment Guidance Letter (02-26) for FY ” |
| DOL-ETA-VETS | 17.805 | Homeless Veterans’ Reintegration Program | 1 | “Announcement of Stand Down Grants” |
| DOS-AIT | 19.124 | East Asia and Pacific Grants Program | 1 | “Implementation of Four GCTF Classic Workshops in 2027” |
| DOS-ARM | 19.441 | ECA – American Spaces | 1 | “Enhancing and Supporting the Network of American Spaces” |
| DOS-AUS | 19.040 | Public Diplomacy Programs | 1 | “U.S. Mission to Australia 2026 Annual Program Statement” |
| DOS-AUT | 19.040 | Public Diplomacy Programs | 1 | “Austrian-American Partnership Fund (AAPF)” |
| DOS-BIH | 19.703 | Criminal Justice Systems | 1 | “Strengthening Bosnia and Herzegovina’s Organized Crime ” |
| DOS-DRL | 19.043 | Study of International Parental Child Abduction | 1 | “Effects of International Parental Child Abduction on Ab” |
| DOS-INL | 19.703 | Criminal Justice Systems | 1 | “Disrupting Transnational Criminal Organizations Through” |
| DOS-IRQ | 19.021 | Investing in People in The Middle East and North Africa | 1 | “U.S. Mission Iraq EducationUSA Roadshow” |
| DOS-NEA-AC | 19.502 | Middle East Regional Cooperation Program | 1 | “Middle East Regional Cooperation (MERC)” |
| DOS-NZL | 19.040 | Public Diplomacy Programs | 1 | “Mission Australia APS, 2026” |
| DOS-TUN | 19.040 | Public Diplomacy Programs | 1 | “U.S. EMBASSY TO LIBYA PAS ANNUAL PROGRAM STATEMENT” |
| DOS-ZWE | 19.040 | Public Diplomacy Programs | 1 | “Annual Program Statement” |
| DOT-FAA-FAA ARG | 20.108 | Aviation Research Grants | 1 | “FAA Aviation Research Grants Program” |
| DOT-FAA-FAA COE-AJFE | 20.109 | Air Transportation Centers of Excellence | 1 | “Center of Excellence for Alternative Jet Fuels and Envi” |
| DOT-FAA-FAA COE-TTHP | 20.109 | Air Transportation Centers of Excellence | 1 | “COE for Technical Training and Human Performance” |
| DOT-FHWA | 20.199 | Stopping Threats On Pedestrian Competitive Grant Program (The Bollards Program) | 1 | “FY26 - Stopping Threats On Pedestrian Competitive Grant” |
| DOT-FHWA | 20.227 | Technology & Innovation Deployment Program 503(c) | 1 | “FY25 and FY26 Advanced Digital Construction Management ” |
| DOT-FHWA | 20.284 | Promoting Resilient Operations for Transformative, Efficient, and Cost-Saving Transportation (PROTECT) | 1 | “FYs 2024 through 2026 - Promoting Resilient Operations ” |
| DOT-FMCSA | 20.218 | Motor Carrier Safety Assistance | 1 | “Development of Fiscal Year 2027 Commercial Vehicle Safe” |
| DOT-FRA | 20.314 | Railroad Development | 1 | “FY26 Atlantic Gateway, Arlington to Alexandria Fourth T” |
| DOT-FTA | 20.530 | Public Transportation Innovation | 1 | “FY26 Bus Safety, Accessibility, and Innovation Notice o” |
| DOT-FTA | 20.537 | Innovative Coordinated Access and Mobility (ICAM) Grants | 1 | “FY 2026 Notice of Funding Opportunity: Innovative Coord” |
| DOT-NHTSA | 20.614 | National Highway Traffic Safety Administration (NHTSA) Discretionary Safety Grants and Cooperative Agreements | 1 | “Innovative Traffic Safety Enforcement (ITSE) Grant Prog” |
| EPA | 66.445 | Innovative Water Infrastructure Workforce Development Program (SDWA 1459E) | 1 | “Innovative Water Infrastructure Workforce Development G” |
| EPA | 66.460 | Nonpoint Source Implementation Grants | 1 | “Fiscal Year (FY) 2026 Funding Opportunity for Indian Tr” |
| EPA | 66.815 | Brownfields Job Training Cooperative Agreements | 1 | “FY27 Brownfields Job Training (JT) Grants” |
| EPA | 66.965 | Alaska Native Claims Settlement Act Contaminated Land Assistance Agreements | 1 | “CONTAMINATED ALASKA NATIVE CLAIMS SETTLEMENT ACT LANDS ” |
| HHS-ACF | 93.575 | Child Care and Development Block Grant | 1 | “Evaluations of Practices for Program Integrity and Frau” |
| HHS-ACF-OCS | 93.570 | Community Services Block Grant Discretionary Awards | 1 | “Community Economic Development Projects” |
| HHS-ACF-OCS | 93.647 | Social Services Research and Demonstration | 1 | “Diaper Distribution Demonstration Research Pilot (DDDRP” |
| HHS-ACF-OFVPS | 93.496 | Family Violence Prevention and Services/Culturally Specific Domestic Violence and Sexual Violence Services | 1 | “Culturally Specific Domestic Violence and Sexual Assaul” |
| HHS-ACF-ORR | 93.576 | Refugee and Entrant Assistance Discretionary Grants | 1 | “Placement and Coordination Program” |
| HHS-ACF-ORR | 93.676 | Unaccompanied Children Program | 1 | “Home Study and Post-Release Services for Unaccompanied ” |
| HHS-CDC-GHC | 93.494 | Global Tuberculosis:Developing,Evaluating,Implementing Evidence-based and Innovative Approaches to Find, Cure, and Prevent Tuberculosis Globally | 1 | “Ending HIV and TB as public health threats through an a” |
| HHS-CDC-NCBDDD | 93.073 | Birth Defects and Developmental Disabilities - Prevention and Surveillance | 1 | “Long-term health outcomes of people living with spina b” |
| HHS-CDC-NCCDPHP | 93.898 | Cancer Prevention and Control Programs for State, Territorial and Tribal Organizations | 1 | “Cancer Prevention and Control Programs for State, Terri” |
| HHS-CDC-NCEZID | 93.318 | Protecting and Improving Health Globally: Building and Strengthening Public Health Impact, Systems, Capacity and Security | 1 | “Advancing Global Capacity to Detect and Respond to Fung” |
| HHS-CDC-OPHPR | 93.354 | Public Health Emergency Response:  Cooperative Agreement for Emergency Response: Public Health Crisis Response | 1 | “Public Health Crisis Response Cooperative Agreement” |
| HHS-HRSA | 93.224 | Health Center Program | 1 | “Fiscal Year 2027 Expanding Nutrition Services” |
| HHS-OS-ASPR | 93.817 | Hospital Preparedness Program (HPP) Ebola Preparedness and Response Activities | 1 | “Trauma Care Readiness and Coordination Cooperative Agre” |
| HHS-OS-ONC | 93.345 | Leading Edge Acceleration Projects (LEAP) in Health Information Technology | 1 | “Leading Edge Acceleration Projects (LEAP) in Health Inf” |
| HUD | 14.416 | Education and Outreach Initiatives | 1 | “Fair Housing Initiatives Program - Education and Outrea” |
| HUD | 14.418 | Private Enforcement Initiatives | 1 | “FAIR HOUSING INITIATIVES PROGRAM PRIVATE ENFORCEMENT IN” |
| HUD | 14.506 | General Research and Technology Activity | 1 | “Authority to Accept Unsolicited Proposals for Research ” |
| HUD | 14.862 | Indian Community Development Block Grant Program | 1 | “Application Instructions for the Indian Community Devel” |
| HUD | 14.870 | Resident Opportunity and Supportive Services - Service Coordinators | 1 | “ROSS Rapid Response Program” |
| HUD | 14.922 | Lead-Safe and Healthy Homes Financing Demonstration | 1 | “Lead-Safe and Healthy Homes Financing Demonstration” |
| IMLS | 45.032 | 21st Century Museum Professional Program | 1 | “21st Century Museum Professionals Program (2027)” |
| IMLS | 45.033 | Museum Grants for American Latino History and Culture | 1 | “Museum Grants for American Latino History and Culture (” |
| IMLS | 45.308 | Native American/Native Hawaiian Museum Services Program | 1 | “Native American/Native Hawaiian Museum Services (2027)” |
| IMLS | 45.309 | Museum Grants for African American History and Culture | 1 | “Museum Grants for African American History and Culture ” |
| IMLS | 45.313 | Laura Bush 21st Century Librarian Program | 1 | “Laura Bush 21st Century Librarian Program (2027)” |
| LOC | 42.015 | Lewis-Houghton Civics and Democracy Initiative | 1 | “Lewis-Houghton Civics and Democracy Initiative: New Awa” |
| NEA | 45.025 | Promotion of the Arts Partnership Agreements | 1 | “Partnership Agreement Grants, FY 2027” |
| NEH | 45.035 | Collaborative Research | 1 | “Collaborative Research” |
| NEH | 45.037 | National Endowment for the Humanities: Collections Stewardship | 1 | “Collections Stewardship” |
| NEH | 45.040 | National Endowment for the Humanities: Scholarly Editions and Translations | 1 | “Scholarly Editions and Translations” |
| ONDCP | 95.007 | Research and Data Analysis | 1 | “Improving the Capacity of Tribal Communities to Identif” |
| SBA | 59.043 | Women's Business Ownership Assistance | 1 | “SBA WBC Modernization Initiative FY26 - Georgia” |
| USDA-AMS | 10.170 | Specialty Crop Block Grant Program - Farm Bill | 1 | “Specialty Crop Multi-State Grant Program 2026” |
| USDA-AMS | 10.173 | Sheep Production and Marketing Grant Program | 1 | “Sheep Production and Marketing Grant Program FY 2026” |
| USDA-AMS | 10.197 | Cold Chain Grants for Emergency Food Assistance | 1 | “Cold Chain Grants for Emergency Food Assistance” |
| USDA-FAS | 10.621 | Assisting Specialty Crop Exports | 1 | “Assisting Specialty Crop Exports: Low Oxygen Storage an” |
| USDA-FAS | 10.960 | Technical Agricultural Assistance | 1 | “Coordinating Agricultural Development & Innovation (CAD” |
| USDA-FS | 10.675 | Urban and Community Forestry Program | 1 | “2026 National Urban and Community Forestry Challenge Co” |
| USDA-FS | 10.676 | Forest Legacy Program | 1 | “Forest Legacy Program - FY2028 Funding” |
| USDA-FS | 10.684 | International Forestry Programs | 1 | “International Programs & Trade, Invasive Species Progra” |
| USDA-NIFA | 10.210 | Higher Education National Needs Graduate Fellowship Grants | 1 | “Food and Agricultural Sciences National Needs Graduate ” |
| USDA-NIFA | 10.216 | 1890 Institution Capacity Building Grants | 1 | “1890 Institution Teaching, Research, and Extension Capa” |
| USDA-NIFA | 10.217 | Higher Education - Institution Challenge Grants Program | 1 | “Higher Education Challenge   Grants Program” |
| USDA-NIFA | 10.221 | Tribal Colleges Education Equity Grants | 1 | “Tribal Colleges Education Equity Grants Program” |
| USDA-NIFA | 10.227 | 1994 Institutions Research Grants | 1 | “Tribal Colleges Research Grants Program” |
| USDA-NIFA | 10.304 | Food and Agriculture Defense Initiative (FADI) | 1 | “Food and Agriculture Defense Initiative Extension Disas” |
| USDA-NIFA | 10.309 | Specialty Crop Research Initiative | 1 | “Emergency Citrus Disease Research and Extension Pre-App” |
| USDA-NIFA | 10.318 | Women and Minorities in Science, Technology, Engineering, and Mathematics Fields | 1 | “Science, Technology, Engineering, and Mathematics Field” |
| USDA-NIFA | 10.326 | Capacity Building for Non-Land Grant Colleges of Agriculture (NLGCA) | 1 | “Capacity Building Grants for Non-Land-Grant Colleges of” |
| USDA-NIFA | 10.443 | Outreach and Assistance for Veteran Farmers and Ranchers Program | 1 | “Outreach and Assistance for Veteran Farmers and Rancher” |
| USDA-NIFA | 10.517 | Tribal Colleges Extension Programs | 1 | “Tribal Colleges Extension Program Special Emphasis” |
| USDA-NIFA | 10.520 | Agriculture Risk Management Education Partnerships Competitive Grants Program | 1 | “Agriculture Risk Management Education Partnerships Comp” |
| USDA-NIFA | 10.524 | Scholarships for Students at 1890 Institutions | 1 | “Scholarships for Students at 1890 Institutions (1890 Sc” |
| USDA-NRCS | 10.933 | Wetland Mitigation Banking Program | 1 | “Wetland Mitigation Banking Program Fiscal Year (FY) 202” |
| USDA-NRCS | 10.934 | Feral Swine Eradication and Control Pilot Program | 1 | “NRCS' Feral Swine Eradication and Control Pilot Program” |
| USDA-RHS | 10.433 | Rural Housing Preservation Grants | 1 | “Rural Housing Preservation Grant” |
| USDA-RUS | 10.862 | Rural Decentralized Water Systems Grant Program | 1 | “Rural Decentralized Water System Grant Program” |
| USDOJ-OJP-BJA | 16.015 | Missing Alzheimer's Disease Patient Assistance Program | 1 | “BJA FY 2026 The Kevin and Avonte Program: Reducing Inju” |
| USDOJ-OJP-BJA | 16.043 | Veterans Treatment Court Discretionary Grant Program | 1 | “U.S. Department of Justice FY26 Coordinated Tribal Assi” |
| USDOJ-OJP-BJA | 16.051 | Crime Gun Intelligence Training and Education | 1 | “BJA FY25 Forensic Ballistics and Higher Education Progr” |
| USDOJ-OJP-BJA | 16.065 | Training to Improve Police-Based Responses to the People with Mental Illness | 1 | “BJA FY 2026 Crisis Response Training Program” |
| USDOJ-OJP-BJA | 16.074 | Daniel Anderl Act Judicial Security | 1 | “BJA FY 2026 Daniel Anderl Judicial Security and Privacy” |
| USDOJ-OJP-BJA | 16.583 | Children's Justice Act Partnerships for Indian Communities | 1 | “U.S. Department of Justice FY26 Coordinated Tribal Assi” |
| USDOJ-OJP-BJA | 16.585 | Treatment Court Discretionary Grant Program | 1 | “U.S. Department of Justice FY26 Coordinated Tribal Assi” |
| USDOJ-OJP-BJA | 16.596 | Tribal Justice Assistance | 1 | “U.S. Department of Justice FY26 Coordinated Tribal Assi” |
| USDOJ-OJP-BJA | 16.710 | Public Safety Partnership and Community Policing Grants | 1 | “U.S. Department of Justice FY26 Coordinated Tribal Assi” |
| USDOJ-OJP-BJA | 16.731 | Tribal Youth Program | 1 | “U.S. Department of Justice FY26 Coordinated Tribal Assi” |
| USDOJ-OJP-BJA | 16.735 | PREA Program: Strategic Support for PREA Implementation | 1 | “BJA FY26 Investigating and Prosecuting Sexual Assaults ” |
| USDOJ-OJP-BJA | 16.745 | Criminal and Juvenile Justice and Mental Health Collaboration Program | 1 | “BJA FY 2026 Public Safety and Mental Health Initiative” |
| USDOJ-OJP-BJA | 16.752 | Economic, High-Tech, and Cyber Crime Prevention | 1 | “BJA FY 2026 Intellectual Property Enforcement Program: ” |
| USDOJ-OJP-BJA | 16.754 | Harold Rogers Prescription Drug Monitoring Program | 1 | “BJA FY 2026 Harold Rogers Prescription Drug Monitoring ” |
| USDOJ-OJP-BJA | 16.835 | Body Worn Camera Policy and Implementation | 1 | “BJA FY26 Body-Worn Camera Policy and Implementation Pro” |
| USDOJ-OJP-BJS | 16.550 | State Justice Statistics Program for Statistical Analysis Centers | 1 | “BJS FY 2026 State Justice Statistics Program for Statis” |
| USDOJ-OJP-BJS | 16.813 | NICS Act Record Improvement Program | 1 | “BJS FY 2026 Consolidated National Criminal History Impr” |
| USDOJ-OJP-OVC | 16.035 | Preventing Trafficking of Girls | 1 | “OVC FY 2026 Preventing Trafficking of Girls” |
| USDOJ-OJP-OVC | 16.321 | Antiterrorism Emergency Reserve | 1 | “OVC FY26 Invited to Apply Antiterrorism and Emergency A” |
| USDOJ-OJP-OVW | 16.055 | Tribal Special Assistant United States Attorneys | 1 | “OVW Fiscal Year 2026 Violence Against Women Tribal Spec” |
| USDOJ-OJP-OVW | 16.062 | Grants to State and Tribal Courts to Implement Protection Order Pilot Programs | 1 | “OVW Fiscal Year 2026 Electronic Service Protection Orde” |
| USDOJ-OJP-OVW | 16.528 | Enhanced Training and Services to End Violence and Abuse of Women Later in Life | 1 | “OVW Fiscal Year 2026 Training and Services to End Abuse” |
| USDOJ-OJP-OVW | 16.529 | Education, Training, and Enhanced Services to End Violence Against and Abuse of Women with Disabilities | 1 | “OVW Fiscal Year 2026 Training and Services to End Viole” |
| USDOJ-OJP-OVW | 16.888 | Consolidated And Technical Assistance Grant Program to Address Children and Youth Experiencing Domestic and Sexual Violence and Engage Men and Boys as Allies | 1 | “OVW Fiscal Year 2026 Consolidated Grant Program to Assi” |

236 distinct (agency, assistance listing) pairs across the 536 posted non-NIH notices.

## 8. `fit_topic_idf` today — the “before” half of D63's baseline

| Metric | Value |
|---|---|
| rows | 1466 |
| `n` (profiled open notices at the last refresh) | 436 |
| last `computed_at` | 2026-09-07T10:18:58.338+00:00 |
| kinds | mesh 1000 |
| `opportunity_fit_profiles` rows now | 436 |

Twenty highest-`df` codes:

| code | kind | df | n | idf |
|---|---|---|---|---|
| C23 | mesh | 73 | 436 | 1.7759 |
| H01 | mesh | 64 | 436 | 1.9055 |
| H02 | mesh | 57 | 436 | 2.0195 |
| H01.158 | mesh | 55 | 436 | 2.0546 |
| H02.403 | mesh | 55 | 436 | 2.0546 |
| L01 | mesh | 49 | 436 | 2.1679 |
| C10 | mesh | 44 | 436 | 2.2733 |
| C23.550 | mesh | 44 | 436 | 2.2733 |
| F03 | mesh | 43 | 436 | 2.2957 |
| F02 | mesh | 41 | 436 | 2.3423 |
| H01.158.273 | mesh | 41 | 436 | 2.3423 |
| J01 | mesh | 40 | 436 | 2.3664 |
| E02 | mesh | 38 | 436 | 2.4164 |
| G07 | mesh | 38 | 436 | 2.4164 |
| N01 | mesh | 38 | 436 | 2.4164 |
| C23.888 | mesh | 36 | 436 | 2.4690 |
| H01.158.273.343 | mesh | 36 | 436 | 2.4690 |
| F01 | mesh | 35 | 436 | 2.4964 |
| N01.400 | mesh | 35 | 436 | 2.4964 |
| C10.228 | mesh | 34 | 436 | 2.5246 |

Widening the corpus raises `n` while `df` for these codes stays flat, which inflates every weight — NON_NIH_FEASIBILITY § 7.2. The fix is the corpus-keyed table in NON_NIH_PLAN § “The NIH invariant”, property 3.

### 8a. Profile text sources today (the `thin_notice_profile` cap must be dead code for all of these)

| sources.text | profiles |
|---|---|
| full_text | 436 |

## 9. Is `grants-gov-opportunity-api.ts` reusable, or dead code?

| Metric | Value |
|---|---|
| files scanned (`src`, `scripts`, `supabase`) | 597 |
| direct importers (this script excluded) | 1 |
| one-hop importers of those | 4 |

**Direct importers**

| file | line | statement |
|---|---|---|
| src/lib/funding-opportunities/funding-opportunity-application-materials.ts | 9 | } from "@/lib/funding-opportunities/grants-gov-opportunity-api"; |

**One hop out** (who imports those files)

| file | line | statement |
|---|---|---|
| src/app/(app)/opportunities/[id]/page.tsx | 11 | import { formatApplicationDocumentSize } from "@/lib/funding-opportunities/funding-opportu |
| src/components/opportunities/opportunity-peek.tsx | 11 | import { formatApplicationDocumentSize } from "@/lib/funding-opportunities/funding-opportu |
| src/lib/funding-opportunities/funding-opportunity-application-materials.test.ts | 5 | } from "@/lib/funding-opportunities/funding-opportunity-application-materials"; |
| src/lib/funding-opportunities/funding-opportunity-peek.ts | 26 | } from "@/lib/funding-opportunities/funding-opportunity-application-materials"; |

**It is not dead code.** 1 file(s) import it, and they are reached from render paths. NON_NIH_FEASIBILITY § 3(3) and § 13's last bullet should be corrected: PR 5.3 must reuse it without changing the behaviour those call sites depend on.

## 10. Request budget and unevaluated predicates

| host | requests issued |
|---|---|
| api.simpler.grants.gov | 536 |
| api.grants.gov | 100 |
| nsf-gov-resources.nsf.gov | 75 |
| www.nsf.gov | 91 |
| cdmrp.health.mil | 79 |
| api.reporter.nih.gov | 34 |

All nine predicates evaluated.

