> Generated from the published design artifact **Prospera Fit Architecture** (v1.2, September 2026): https://claude.ai/code/artifact/55be6396-fc0d-41b7-83f2-dc6533f3c514 — the artifact carries the pipeline, adversarial-case and AI-ensemble figures, which are omitted here. Supersedes `IMPLEMENTATION_PLAN_MATCHING.md`. Implementation package: `docs/fit-engine/` and `src/lib/fit/`.

Prospera · Investigator ↔ funding-opportunity matching · Design specification v1.2 · September 2026

# Prospera Fit Architecture

A redesign of investigator–opportunity matching around *how* an investigator does research — paradigm, unit of analysis, study design — with topical similarity demoted to one input among several.

*§1 · Frames the whole brief*

## Summary

Prospera currently answers “do this person and this notice talk about the same things?” The question it needs to answer is “does this person do the kind of research this notice is designed to fund?” Those are different questions, and the second one cannot be recovered from the first.

The present engine embeds an investigator’s career into one 1,536-dimensional vector, embeds a notice’s synopsis into another, and sorts by cosine similarity with three fixed cut-offs (0.40 / 0.45 / 0.50). General-purpose text embeddings encode *subject matter* far more strongly than *study design*: a paper on T-cell exhaustion in murine tumors and a clinical-trial notice for T-cell therapies share most of their vocabulary and land close together, while the words that would separate them — *randomized*, *enrollment*, *knockout*, *cohort* — are a small fraction of the tokens and average out. The Outreach engine then goes further and explicitly deletes those words: its `GENERIC_WORDS` list strips *clinical*, *preclinical*, *basic*, *translational*, *human*, *vivo*, *vitro*, *outcomes* and *risk* before matching. The signal that distinguishes paradigms is removed on purpose, to stop generic inflation, and the two goals are never reconciled.

The redesign treats **scientific topic** and **research paradigm** as orthogonal, and adds three more structured axes — **unit of analysis**, **study design**, and **materials/data** — each inferred per evidence item and aggregated with recency and role weights into a multi-label profile with weights rather than a single tag. Funding notices get the same decomposition from their *full* text (which Prospera already fetches from the NIH Guide and parses only for dates), reinforced by deterministic signals — activity code, issuing division, clinical-trial designation — and, for reissued announcements, by the empirical distribution of projects RePORTER shows were actually funded under them.

Matching becomes a staged pipeline in which eligibility, paradigm, unit and design act as **multiplicative gates**, topic and methods rank the survivors, an LLM adjudicates the short-list with asymmetric authority (it can lower a tier freely, raise one only with a cited reason), and a final calibration step assigns a tier by **conjunctive floors**: “Strong fit” requires every one of seven dimensions to clear its own bar. A 0.95 disease match with a 0.20 paradigm match cannot become Strong under this design; it cannot even become Moderate.

Almost every signal the new design needs is already being downloaded. The PubMed ingest calls `efetch` and discards MeSH headings and publication types; the ClinicalTrials.gov ingest stores the full study record and never reads `studyType`, `phases`, `primaryPurpose`, or the investigator’s role; RePORTER responses carry abstracts, RCDC spending categories and study-section names that are never used structurally; the NIH Guide HTML for every notice is fetched and only Key Dates are kept. The first phase of the plan is therefore data capture, not modeling.

Primary optimization target

Precision at the top of the list and investigator trust. Five defensible opportunities beat twenty that mention the right disease. Recall is protected by the Exploratory tier, which is where “interesting but would need a collaborator or a new direction” lives — visibly separated from recommendations.

*§2 · Diagnosis · grounds the redesign in the code*

## Why the current engine over-matches

Three surfaces, two engines, one shared blind spot: none of them represents how research is conducted.

Prospera has three fit surfaces. The investigator detail page ranks open notices for one person (`rankOpportunitiesForInvestigator`); the Outreach recipients tab ranks the directory for one notice (`runSuggestions`); and the opportunity detail page shows a “Best fit in your directory” list from an older tag-overlap engine (`lib/quick-match`). The first two share the same embeddings and thresholds. The third uses different logic and produces different names for the same notice. The specific weaknesses, with the code that causes them:

| Weakness                                                         | Where                                                                                         | Effect on fit                                                                                                                                                                                                                                                                                                                                                               |
|------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **One vector per career**                                        | embeddings.ts:168 — evidence joined into one text, ≤12,000 chars                              | A physician-scientist with 30 clinical papers and 5 lab papers becomes a blurred centroid that is moderately close to everything in their disease. Secondary lines of work are both over-credited (any topical hit counts) and under-described (no notion of what share of the work they represent).                                                                        |
| **Paradigm words deleted before matching**                       | suggest.ts:69 `GENERIC_WORDS`; termHits skips generic terms                                   | The facet checker cannot see “clinical”, “preclinical”, “vivo”, “vitro”, “human”, “outcomes”. The `stage` facet the LLM extracts (basic / preclinical / translational / clinical / implementation) is never compared against anything on the investigator side.                                                                                                             |
| **Controlled vocabulary collapses the distinctions that matter** | vocab-config.ts:149–152                                                                       | `epidemiology → population_health`; `implementation science → health_services_research`. The legacy tag layer cannot express the difference between a cohort epidemiologist and a health-services researcher, or between clinical and population research.                                                                                                                  |
| **Tier is a similarity threshold**                               | rank-opportunities.ts:76; suggest.ts:229–236                                                  | Investigator page: Strong = cosine ≥ 0.50 plus two supporting items from two sources. No eligibility, facet, or design check at all. Outreach: adds facet term hits and flag caps, but “Potential” needs only cosine ≥ 0.45 and a single topical term hit — a low bar for a broad notice.                                                                                   |
| **Notice profile from a synopsis, not the solicitation**         | profile.ts:70 — description truncated at 9,000 chars; gpt-4o-mini                             | The Simpler.Grants.gov synopsis rarely contains Section I’s “Specific Areas of Research Interest” or the “Non-Responsive” list, which is where paradigm requirements live. The full Guide HTML is fetched (`nih-guide/client.ts`) and parsed only for Key Dates.                                                                                                            |
| **Modality evidence discarded on ingest**                        | pubmed-ingest.ts (efetch, no MeSH); clinicaltrials-ingest.ts:69–102; reporter raw_json unused | Publication types (*Randomized Controlled Trial*, *Observational Study*), check tags (*Humans*, *Mice*, *Cell Line*), CT.gov `studyType`/`primaryPurpose`/investigator role, and RePORTER RCDC categories, study sections and activity codes are all available and all unused. Trials are declared as an evidence kind and never collected (`collectInvestigatorEvidence`). |
| **No negative evidence**                                         | all three engines                                                                             | Nothing lowers a score for a fundamental mismatch. The Outreach `excluded` facet flags conflicting *aims* mentioned in evidence, but a basic scientist with zero human-subjects work is not penalized against a “Clinical Trial Required” notice.                                                                                                                           |
| **Topic dominates by construction**                              | suggest.ts:240 `score = top·0.75 + …`                                                         | Ordering within a tier is 75% raw cosine. Since cosine is mostly topic, the list is a topic ranking with a thin facet veneer.                                                                                                                                                                                                                                               |

None of this is a tuning problem. Moving `SIM.strong` from 0.50 to 0.55 would shorten lists without changing what they contain, because the ordering itself is topical. The fix is representational: make paradigm, unit and design explicit quantities that can be compared, gated on, and explained.

*§3 · Approach survey and comparison*

## Approach landscape

No single technique solves this. The methods that discriminate paradigm well are weak at topic, and vice versa; the recommended architecture composes them by role.

Each approach below is rated for what it contributes to *this* problem. “Topic vs. paradigm” is the column that matters most here: it asks whether the method can tell a lupus trialist from a lupus mechanist when both write about lupus.

<table class="compact" style="width:100%;">
<colgroup>
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
<col style="width: 10%" />
</colgroup>
<thead>
<tr class="header">
<th style="min-width: 190px">Approach</th>
<th>Precision</th>
<th>Recall</th>
<th>Topic vs. paradigm</th>
<th>Explainable</th>
<th>Compute</th>
<th>Data needed</th>
<th>Build / maintain</th>
<th>Improves over time</th>
<th style="min-width: 260px">Role in the recommended design</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>Keyword / weighted lexical overlap</strong><br />
current quick-match engine</td>
<td>Low</td>
<td>Med</td>
<td>None</td>
<td>High</td>
<td>Trivial</td>
<td>Curated vocab</td>
<td>Cheap to build, endless to maintain synonyms</td>
<td>Manual</td>
<td>Retire. Its one virtue — legible “matched on X, Y” — is preserved by structured facet comparison.</td>
</tr>
<tr class="even">
<td><strong>TF-IDF / BM25</strong></td>
<td>Med</td>
<td>High</td>
<td>Weak</td>
<td>High</td>
<td>Low</td>
<td>Corpus only</td>
<td>Easy (pg_trgm / tsvector or a small index)</td>
<td>Corpus-driven</td>
<td>Topic stage, as a complement to embeddings. IDF over the notice corpus is the principled cure for generic-term inflation (§11): “cancer” and “immune” earn near-zero weight automatically.</td>
</tr>
<tr class="odd">
<td><strong>Dense embeddings (bi-encoder)</strong><br />
current primary engine</td>
<td>Med</td>
<td>High</td>
<td>Weak</td>
<td>Low</td>
<td>Low</td>
<td>None</td>
<td>Already built</td>
<td>Static</td>
<td>Candidate generation and one input to the topic score — computed <em>per evidence item</em>, only over paradigm-compatible items. Never the tier.</td>
</tr>
<tr class="even">
<td><strong>Cross-encoder reranker</strong></td>
<td>High</td>
<td>—</td>
<td>Some</td>
<td>Low</td>
<td>Med</td>
<td>None (pretrained)</td>
<td>Moderate; a hosted model or self-hosted</td>
<td>Fine-tunable</td>
<td>Optional later swap-in for topic scoring if BM25+embeddings prove noisy. Not needed for v1.</td>
</tr>
<tr class="odd">
<td><strong>LLM pointwise relevance judgment</strong></td>
<td>High</td>
<td>—</td>
<td>High</td>
<td>High</td>
<td>High</td>
<td>None</td>
<td>Prompt engineering; drift risk</td>
<td>Prompt-level</td>
<td>Final adjudication of the short-list only (Stage 8). Too expensive and too variable to run over 5,000 notices × directory; excellent on 15 candidates with structured inputs.</td>
</tr>
<tr class="even">
<td><strong>Hybrid retrieval → structured gates → LLM rerank</strong></td>
<td>High</td>
<td>High</td>
<td>High</td>
<td>High</td>
<td>Med</td>
<td>Structured profiles</td>
<td>The main build</td>
<td>Yes</td>
<td><strong>The recommended architecture</strong> (§7). Each component does what it is good at.</td>
</tr>
<tr class="odd">
<td><strong>Rule-based eligibility and exclusion</strong></td>
<td>High</td>
<td>—</td>
<td>n/a</td>
<td>High</td>
<td>Trivial</td>
<td>Career stage, degrees, appointment, citizenship where stated</td>
<td>Small rule set; FOA eligibility text is formulaic</td>
<td>Manual</td>
<td>Stage 1 hard filter. Extend the existing <code>eligibility()</code> with structured career-stage and clinical-trial-designation rules.</td>
</tr>
<tr class="even">
<td><strong>Structured profile modeling</strong><br />
facet extraction → axis-wise comparison</td>
<td>High</td>
<td>Med</td>
<td>High</td>
<td>High</td>
<td>Med (one-time extraction)</td>
<td>MeSH, CT.gov design fields, RePORTER, FOA full text</td>
<td>Schema + classifiers; the core investment</td>
<td>Yes</td>
<td>Stages 2–6. The representation everything else reasons over (§4–6).</td>
</tr>
<tr class="odd">
<td><strong>Grant- and publication-based similarity</strong><br />
MeSH profile distance, project-to-notice</td>
<td>High</td>
<td>Med</td>
<td>High via MeSH</td>
<td>High</td>
<td>Low</td>
<td>MeSH per paper; RePORTER abstracts</td>
<td>Cheap once MeSH is captured</td>
<td>Corpus-driven</td>
<td>The primary evidence source for both paradigm and topic axes. MeSH check tags and publication types are the highest-precision modality signal available for free.</td>
</tr>
<tr class="even">
<td><strong>Exemplar matching against funded projects</strong><br />
RePORTER projects awarded under the same FOA</td>
<td>High</td>
<td>Med</td>
<td>High</td>
<td>High</td>
<td>Low</td>
<td>RePORTER by FOA number (reissued PAs/PARs)</td>
<td>Easy; one API query per notice</td>
<td>Self-updating</td>
<td>Opportunity-profile prior (§6): what a program <em>actually funded</em> is the best estimate of what it wants. Not available for brand-new RFAs.</td>
</tr>
<tr class="odd">
<td><strong>Collaborative filtering</strong><br />
investigators like you pursued notices like this</td>
<td>Med</td>
<td>High</td>
<td>Indirect</td>
<td>Low</td>
<td>Low</td>
<td>Hundreds of interaction pairs</td>
<td>Easy once feedback exists; cold-start problem</td>
<td>Yes</td>
<td>Later. Directory-scale data (a few hundred people, hundreds of notices) is too sparse for CF to lead; use as a weak feature once submissions/awards accumulate.</td>
</tr>
<tr class="even">
<td><strong>Learning-to-rank</strong><br />
pairwise/lambda over component scores</td>
<td>High</td>
<td>High</td>
<td>Inherits from features</td>
<td>Med</td>
<td>Low</td>
<td>≈300–500 labeled pairs for a low-dimensional model</td>
<td>Small model over ~10 features; needs a gold set</td>
<td>Yes</td>
<td>Stage 9 weight tuning once labels exist (§12). Do <em>not</em> learn end-to-end from text: the feature set is the explainability.</td>
</tr>
</tbody>
</table>

Two observations drive the design. First, the methods that score well on “topic vs. paradigm” all operate on *structure* — MeSH descriptors, trial registry fields, activity codes, extracted facets — not on raw text. Second, the methods that are cheap enough to run across the whole notice corpus (BM25, embeddings) are the ones that cannot see paradigm. So the pipeline must be ordered: structured gates first, on a representation that is computed once per item; text similarity afterwards, restricted to what survived.

On embedding models: swapping `text-embedding-3-small` for a scientific-document model (SPECTER2, SciNCL) or a larger general model would improve topical ranking at the margin. It would not fix the paradigm problem, because the pretraining objective of every such model rewards topical proximity. Keep the current model for v1 and revisit only after the structured layer is in place.

*§4 · Answers asks 1 – 5*

## Research-type taxonomy

Five structured axes describe *how* research is done. A sixth — scientific topic — describes *what* it is about. Every axis is multi-label with weights in \[0, 1\]; nothing is forced into a single category.

The axes are deliberately partially redundant. Paradigm is the coarse summary a strategist would give; unit of analysis and study design are the finer-grained facts that paradigm is usually inferred from. Keeping all three lets the system gate on the coarse axis (cheap, robust) and score on the fine ones (precise, explainable), and lets an unusual investigator — a basic immunologist who works exclusively in human primary cells — be represented honestly: discovery paradigm, molecular unit, wet-lab design, human materials.

Research paradigm AXIS A · 23 categories in 7 families

What kind of scientific question is asked and what kind of evidence is produced. The gating axis.

Unit of analysis AXIS B · 14 units in 5 levels

The level at which observations are made: molecule through health system. A level cliff separates non-human from human and individual from aggregate.

Study design AXIS C · 27 designs in 9 groups

What the investigator actually does, and what the notice requires, allows or prohibits.

Materials and data AXIS D · 16 kinds

Cell lines through claims databases. Distinguishes “human research” that is molecular from “human research” that is populational.

Scientific objective AXIS E · 14 objectives

Mechanism discovery, biomarker validation, treatment evaluation, etiology, delivery, implementation… the purpose the work serves.

Scientific topic SEPARATE · coded + free text

Disease/condition (MeSH C-tree, RCDC), organ system, biological process/pathway (MeSH D/G-trees), population descriptors, and the free-text scientific question. Scored, never gated.

### Axis A — Research paradigm

Families exist for gating: compatibility between two investigators, or an investigator and a notice, is computed at the family level first, then refined within a family. Cross-cutting paradigms (family 7) do not gate on their own; their compatibility is decided by the unit, design and materials axes, because a computational scientist belongs wherever their data does.

| Family                            | Category                       | One-line definition                                                                                                            | Highest-precision signals                                                                                                                                                  |
|-----------------------------------|--------------------------------|--------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1 Discovery**                   | basic_discovery                | Fundamental questions about biological systems without a stated disease application.                                           | MeSH check tags Animals/Cell Line without Humans; journals; R01/R35 from NIGMS; study sections in molecular/cellular IRGs.                                                 |
|                                   | molecular_cellular_mechanistic | How a pathway, gene or cell type produces a phenotype, usually disease-motivated.                                              | MeSH: Signal Transduction, Gene Expression Regulation, Mice Knockout, Cells Cultured; perturbation-design terms (CRISPR, knockdown).                                       |
| **2 Preclinical**                 | preclinical                    | Testing interventions or hypotheses in model systems before humans.                                                            | MeSH: Disease Models Animal, Drug Evaluation Preclinical, Xenograft Model Antitumor Assays.                                                                                |
|                                   | animal_model                   | In vivo work in animals as the primary system.                                                                                 | Check tags Mice/Rats/Zebrafish/Primates without Humans; animal-facility language in RePORTER abstracts.                                                                    |
| **3 Translational human biology** | translational                  | Moving a mechanism or agent toward human application; bridging papers with both animal and human material.                     | Triangle-of-biomedicine compound classes (Animal+Human, Cell+Human); RCDC “Translational Research”.                                                                        |
|                                   | human_biospecimen              | Mechanistic or biomarker work on human tissue, blood or cells.                                                                 | MeSH Humans + Biopsy / Biomarkers / Specimen Handling / primary cell culture; no enrollment or trial terms.                                                                |
|                                   | early_phase_human_experimental | First-in-human, phase 0/I, mechanistic studies in volunteers or patients (incl. NIH “basic experimental studies with humans”). | CT.gov `phases: PHASE1 / EARLY_PHASE1`; `primaryPurpose: BASIC_SCIENCE`; MeSH Clinical Trial Phase I.                                                                      |
| **4 Clinical**                    | clinical_observational         | Patients as participants; phenotyping, prognosis, treatment response; prospective enrollment without intervention.             | MeSH Observational Study + Prospective Studies + Humans, patient-level terms; CT.gov `studyType: OBSERVATIONAL`, observationalModel COHORT with clinical enrollment.       |
|                                   | interventional_clinical        | Interventions delivered to patients outside a formal trial framework (procedures, devices, care pathways).                     | MeSH Treatment Outcome + procedure terms; case series; surgical journals.                                                                                                  |
|                                   | clinical_trials                | Registered interventional studies, phase I–IV, pragmatic trials.                                                               | CT.gov role PRINCIPAL_INVESTIGATOR on INTERVENTIONAL studies; MeSH Randomized Controlled Trial / Clinical Trial Phase II–IV; K23, K24, UG3/UH3, UM1, U01 (network) awards. |
| **5 Population**                  | epidemiology                   | Incidence, prevalence, risk factors, causal inference at population scale.                                                     | MeSH Cohort Studies + Risk Factors + Incidence/Prevalence + Epidemiologic Studies; large-N cohorts; study sections in Epidemiology IRGs.                                   |
|                                   | genetic_epidemiology           | Genetic variation and disease at population scale (GWAS, Mendelian randomization, polygenic risk).                             | MeSH Genome-Wide Association Study, Polymorphism Single Nucleotide, Mendelian Randomization Analysis; biobank data.                                                        |
|                                   | population_health              | Health of defined populations including social/environmental determinants.                                                     | MeSH Social Determinants of Health, Health Status Disparities, Socioeconomic Factors, Residence Characteristics.                                                           |
|                                   | public_health                  | Surveillance, prevention programs, policy evaluation.                                                                          | MeSH Population Surveillance, Public Health Practice, Health Policy; CDC/AHRQ funding.                                                                                     |
|                                   | community_based                | Research conducted with and in communities, CBPR.                                                                              | MeSH Community-Based Participatory Research, Community Health Services; partnership language.                                                                              |
|                                   | behavioral                     | Behavior, cognition and behavioral interventions as the object of study.                                                       | MeSH Health Behavior, Behavior Therapy, Motivational Interviewing; RCDC Behavioral and Social Science. (A behavioral RCT is also *clinical_trials* via the design axis.)   |
| **6 Health systems**              | comparative_effectiveness      | Head-to-head comparison of interventions in practice.                                                                          | MeSH Comparative Effectiveness Research; RCDC category of the same name; PCORI funding.                                                                                    |
|                                   | health_services                | Utilization, access, cost, quality, delivery models.                                                                           | MeSH Health Services Research, Health Services Accessibility, Delivery of Health Care, Insurance Claim Review; RCDC “Health Services”.                                     |
|                                   | outcomes_research              | Patient-reported and system-level outcomes across settings.                                                                    | MeSH Outcome Assessment Health Care, Patient Reported Outcome Measures, Quality of Health Care.                                                                            |
|                                   | implementation_science         | Adoption, fidelity, scale-up and sustainment of evidence-based practices.                                                      | MeSH Implementation Science (2019+), Diffusion of Innovation; hybrid effectiveness-implementation designs; R18, R01 under D&I PARs.                                        |
| **7 Cross-cutting**               | computational_data_science     | Modeling, machine learning, statistical methods applied to biomedical data.                                                    | MeSH Machine Learning, Computational Biology, Models Statistical; software/GitHub artifacts; NLM/NIBIB funding.                                                            |
|                                   | bioinformatics                 | Analysis of omic and sequence data as the primary contribution.                                                                | MeSH Sequence Analysis, Genomics, Proteomics + Computational Biology; no wet-lab terms.                                                                                    |
|                                   | methods_technology_development | New assays, instruments, algorithms or measures as the deliverable.                                                            | MeSH Equipment Design, Reproducibility of Results, Validation Studies as Topic; R21/R33, R01 under technology PARs, NIBIB/NCI IMAT.                                        |

Signals are indicative; the complete signal-to-axis mapping is in Appendix B. MeSH descriptors are used by tree number, not string, so synonyms and children are covered automatically.

#### Family compatibility matrix

Paradigm compatibility between an investigator and a notice is computed over these values (§8). Cross-cutting paradigms are not in the matrix; their compatibility is taken from axes B–D.

|                  | 1 Disc. | 2 Precl. | 3 Transl. | 4 Clin. | 5 Pop. | 6 Sys. |
|------------------|---------|----------|-----------|---------|--------|--------|
| 1 Discovery      | 1.00    | 0.70     | 0.40      | 0.15    | 0.05   | 0.05   |
| 2 Preclinical    | 0.70    | 1.00     | 0.70      | 0.20    | 0.05   | 0.05   |
| 3 Translational  | 0.40    | 0.70     | 1.00      | 0.60    | 0.20   | 0.15   |
| 4 Clinical       | 0.15    | 0.20     | 0.60      | 1.00    | 0.45   | 0.50   |
| 5 Population     | 0.05    | 0.05     | 0.20      | 0.45    | 1.00   | 0.60   |
| 6 Health systems | 0.05    | 0.05     | 0.15      | 0.50    | 0.60   | 1.00   |

Within a family: same category 1.00, sibling category 0.85. Values ≤ 0.25 trigger the paradigm gate (§9). These are starting values to be calibrated against strategist labels (§14); they encode the judgment that a preclinical scientist is a plausible translational applicant, a clinical researcher is a plausible health-services applicant, and neither is a plausible population epidemiologist.

### Axis B — Unit of analysis

Fourteen units collapsed into five levels for compatibility. The two cliffs — non-human ↔ human and individual ↔ aggregate — are where the user’s “human research is not enough” concern lives: a signaling study in human biopsies sits at level 1 with human materials; a 500,000-person incidence cohort sits at level 4.

| Level                   | Units                                                                                   | L1   | L2   | L3   | L4   | L5   |
|-------------------------|-----------------------------------------------------------------------------------------|------|------|------|------|------|
| L1 molecular–cellular   | molecule · gene/genome · protein · pathway · cell · tissue/organoid (in vitro, ex vivo) | 1.00 | 0.70 | 0.50 | 0.10 | 0.05 |
| L2 organism (non-human) | whole animal                                                                            | 0.70 | 1.00 | 0.35 | 0.10 | 0.05 |
| L3 human individual     | human biospecimen · individual patient/participant                                      | 0.50 | 0.35 | 1.00 | 0.55 | 0.20 |
| L4 human aggregate      | clinical cohort · population · community                                                | 0.10 | 0.10 | 0.55 | 1.00 | 0.60 |
| L5 system               | healthcare organization · health system · policy                                        | 0.05 | 0.05 | 0.20 | 0.60 | 1.00 |

L1↔L3 is 0.50, not lower, because molecular work on human tissue is a real and common bridge (translational human biology). The materials axis distinguishes it from work on cell lines.

### Axis C — Study design

The design axis is where notices state requirements most explicitly (“Clinical Trial Required”, “applications proposing animal studies will be considered non-responsive”, “must use an existing cohort”). It is scored as requirement satisfaction, not similarity: each design the notice *requires* must be supported by investigator evidence; designs it *allows* earn credit; designs it *prohibits* penalize when they dominate the investigator’s work.

| Group                            | Designs                                                                                                              | Investigator evidence                                                                                                                          | Notice evidence                                                                                          |
|----------------------------------|----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Laboratory experimental**      | wet_lab_experiment · perturbation (genetic/pharmacologic) · biochemical_structural · biospecimen_assay               | MeSH Cells Cultured, Gene Knockdown Techniques, CRISPR-Cas Systems, Crystallography; methods vocabulary in abstracts                           | “in vitro”, “mechanistic studies”, “model systems”, NIGMS/NIAID basic PARs                               |
| **In vivo**                      | animal_in_vivo · xenograft_pdx · animal_behavioral                                                                   | Check tags Mice/Rats + Disease Models Animal; IACUC language in RePORTER                                                                       | “animal models”, “preclinical efficacy”, “translational animal studies required”                         |
| **Profiling and omics**          | bulk_omics · single_cell · spatial_imaging · proteomics_metabolomics                                                 | MeSH Single-Cell Analysis, Sequence Analysis RNA, Proteomics, Metabolomics                                                                     | Named platforms; “multi-omic”, “atlas”, “cell census”                                                    |
| **Human observational**          | prospective_cohort · retrospective_cohort · case_control · cross_sectional · registry                                | MeSH Prospective/Retrospective/Cohort/Case-Control/Cross-Sectional Studies, Registries; CT.gov OBSERVATIONAL                                   | “existing cohorts”, “longitudinal follow-up”, “case ascertainment”, “registry linkage”                   |
| **Interventional**               | rct · early_phase_trial · pragmatic_trial · pilot_feasibility_trial · single_arm_interventional                      | MeSH Randomized Controlled Trial, Clinical Trial Phase I–IV, Pragmatic Clinical Trial; CT.gov INTERVENTIONAL + role PI; R34/UG3/U01/UM1 awards | Title “Clinical Trial Required/Optional/Not Allowed”; Section I trial language; “phase II”, “randomized” |
| **Real-world data**              | ehr_analysis · claims_analysis · linked_administrative · surveillance_data                                           | MeSH Electronic Health Records, Insurance Claim Review, Medicare, Databases Factual, Data Linkage                                              | “claims data”, “EHR”, “All of Us”, “SEER-Medicare”, data-enclave requirements                            |
| **Social and behavioral**        | survey · qualitative · mixed_methods · community_engaged                                                             | MeSH Surveys and Questionnaires, Qualitative Research, Interviews as Topic, Focus Groups, CBPR                                                 | “community partners”, “stakeholder engagement”, “qualitative aims”                                       |
| **Analytical and computational** | causal_inference · statistical_epi_modeling · population_simulation · ml_model_development · secondary_data_analysis | MeSH Models Statistical, Machine Learning, Causal inference terms (Mendelian Randomization, Propensity Score), Computer Simulation             | “secondary analysis of existing data”, “methods development”, “predictive models”                        |
| **Implementation**               | hybrid_effectiveness_implementation · implementation_evaluation · dissemination_study                                | MeSH Implementation Science; hybrid type 1/2/3 language; RE-AIM/CFIR frameworks in abstracts                                                   | “implementation strategies”, “adoption”, “sustainment”, D&I PAR numbers                                  |

### Axes D and E — Materials/data and scientific objective

Axis D · Materials and data

- **Non-human:** cell lines · primary cells (non-human) · organoids/iPSC-derived · animals (mouse, rat, zebrafish, NHP, other)
- **Human biological:** human tissue/biopsy · human blood/fluids · human primary cells · biobank specimens
- **Human participants:** enrolled participants · patients under care
- **Human data:** EHR · claims/administrative · registries/surveillance · surveys · cohort/biobank datasets · genomic datasets · imaging datasets · digital/wearable
- **Other:** published literature/meta-data · simulated data

Inferred from MeSH check tags and headings (Humans, Animals, Mice, Cell Line, Biopsy, Electronic Health Records), CT.gov enrollment, and abstract text. Notices state required materials in Section I and in data-access requirements.

Axis E · Scientific objective

- mechanism_discovery · target_identification_validation · biomarker_discovery_validation
- therapeutic_development · treatment_evaluation_efficacy · diagnostic_prognostic_prediction
- etiology_risk_factors · prevention · outcomes_quality · healthcare_delivery_access
- implementation_dissemination · methods_tool_development · resource_infrastructure · training_capacity

Inferred by LLM classification of abstracts and specific-aims-like text; for notices, from the stated purpose in Section I. Objective is scored (§8) but does not gate: a mechanism-discovery lab can legitimately pursue a target-validation notice.

### Worked profile vectors

The two investigators from the brief, expressed in this taxonomy. Weights are the saturated evidence share described in §5; they need not sum to one.

| Axis          | Investigator A — molecular immunologist (mouse lupus models)                                                                                                               | Investigator B — cohort epidemiologist (diabetes)                                                                                                                                        |
|---------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A · paradigm  | molecular_cellular_mechanistic 0.80 · preclinical 0.65 · animal_model 0.70 · translational 0.30 · human_biospecimen 0.25 · clinical_observational 0.05 · epidemiology 0.00 | epidemiology 0.85 · population_health 0.75 · clinical_observational 0.70 · genetic_epidemiology 0.30 · health_services 0.20 · clinical_trials 0.10 · molecular_cellular_mechanistic 0.00 |
| B · unit      | L1 0.85 (pathway, cell) · L2 0.70 · L3 0.25 (biospecimen)                                                                                                                  | L4 0.90 (cohort, population) · L3 0.45 (patient) · L5 0.15                                                                                                                               |
| C · design    | perturbation 0.80 · animal_in_vivo 0.70 · single_cell 0.55 · wet_lab 0.85 · prospective_cohort 0.00 · rct 0.00                                                             | prospective_cohort 0.85 · retrospective_cohort 0.60 · ehr_analysis 0.55 · causal_inference 0.50 · survey 0.30 · rct 0.10                                                                 |
| D · materials | mouse 0.80 · primary cells 0.60 · human blood 0.25                                                                                                                         | cohort datasets 0.90 · EHR 0.55 · biobank specimens 0.30 · enrolled participants 0.40                                                                                                    |
| E · objective | mechanism_discovery 0.85 · target_identification 0.45 · therapeutic_development 0.20                                                                                       | etiology_risk_factors 0.85 · prevention 0.45 · diagnostic_prognostic_prediction 0.40 · outcomes_quality 0.20                                                                             |
| Topic         | C20.111.590 Lupus Erythematosus Systemic · D12.776.124 Immunoglobulins… · G12 Immune System Phenomena · T cells, B cells, IFN signaling                                    | C18.452.394.750 Diabetes Mellitus Type 2 · N01.224 Demography · N06.850.505 Epidemiologic Measurements · social determinants, glycemic outcomes                                          |

Why five axes rather than one “modality” label

Because the failure cases are all mixed. A clinician-scientist who runs trials *and* keeps a translational lab needs two paradigm weights, two unit levels and two design groups, or the system will either deny them mechanistic notices or offer them everything. A single label loses the mixture; a single embedding blends it into mush. Weighted multi-label axes keep the mixture and let each notice test the part of it that matters.

*§5 · Answers ask 6*

## Structured investigator profile

Classify every evidence item on all six axes, then aggregate with source-reliability, recency and role weights. The investigator is a weighted mixture of what they have demonstrably done, with a separate view of what they have done recently.

The current design classifies nothing: it concatenates text. The redesign inverts that. Each publication, grant, registered trial, biosketch statement and Profiles narrative becomes an *item profile* — a small vector on each axis plus topic codes — produced by deterministic rules where structured fields exist and by an LLM classifier where only prose exists. Item profiles are cheap to compute once, are cached by content hash exactly as embeddings are today, and are individually inspectable, which is what makes the final explanation honest: “clinical_trials 0.72, from 4 registered interventional studies as PI and 11 RCT publications since 2019.”

### Sources and what each contributes

<table class="compact">
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th>Source</th>
<th>Fields to capture (new in bold)</th>
<th>Axes informed</th>
<th>Reliability weight</th>
<th>Notes</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>PubMed</strong><br />
already ingested via efetch</td>
<td>title, journal, date, <strong>MeSH headings with tree numbers and major-topic flags, check tags (Humans, Animals, Mice…), publication types, abstract, author position</strong></td>
<td>A B C D E + topic</td>
<td class="n">1.0 verified · 0 name-only</td>
<td>Publication types (<em>Randomized Controlled Trial</em>, <em>Observational Study</em>, <em>Meta-Analysis</em>) and check tags are the single highest-precision paradigm signal and are free in the XML Prospera already fetches. NLM’s automated indexing now assigns MeSH within days, so recency is not a problem.</td>
</tr>
<tr class="even">
<td><strong>NIH RePORTER</strong><br />
raw_json already stored</td>
<td>project number → <strong>activity code</strong>, title, <strong>abstract_text, phr_text, terms, spending_categories_desc (RCDC), study section, agency_ic_admin, is contact PI / MPI</strong>, dates, amounts</td>
<td>A C E + topic; career stage; mechanisms held</td>
<td class="n">1.0</td>
<td>RCDC categories include research-type categories (<em>Clinical Research</em>, <em>Clinical Trials</em>, <em>Health Services</em>, <em>Comparative Effectiveness Research</em>, <em>Prevention</em>, <em>Behavioral and Social Science</em>; verify the current list) alongside disease categories. CSR study-section names are organized by approach and are a strong paradigm prior. K23/K24 = patient-oriented; K08 = laboratory-based clinician-scientist.</td>
</tr>
<tr class="odd">
<td><strong>ClinicalTrials.gov</strong><br />
raw_json already stored</td>
<td><strong>studyType (INTERVENTIONAL / OBSERVATIONAL), phases, designInfo.primaryPurpose, allocation, observationalModel, enrollment count, intervention types, investigator role (overallOfficials PRINCIPAL_INVESTIGATOR / STUDY_CHAIR; responsibleParty)</strong>, conditions, sponsor, dates</td>
<td>A C D; capability</td>
<td class="n">1.0 when role = PI · 0.6 when listed without role</td>
<td>Being PI on ≥ 1 interventional study is near-definitive evidence of trial capability; observational registrations mark clinical_observational or epidemiology depending on enrollment and design. Currently declared as an evidence kind and never collected.</td>
</tr>
<tr class="even">
<td><strong>Biosketch</strong></td>
<td>personal statement, contributions to science (each with citations), positions and honors</td>
<td>A C E + topic; clinical role; self-description of direction</td>
<td class="n">0.9</td>
<td>The most authoritative self-description available; LLM-classified. Statements of <em>intended</em> direction (“my lab is now moving toward…”) are recorded as aspiration, which opens Exploratory but never Strong.</td>
</tr>
<tr class="odd">
<td><strong>UCSF Profiles</strong></td>
<td>keywords (MeSH-derived), freetext keywords, narrative, <strong>title series</strong>, funding list, trials list</td>
<td>Topic; clinical role prior; A weakly</td>
<td class="n">0.6</td>
<td>UCSF title series carries role information: <em>Professor of Clinical Medicine</em> and <em>HS Clinical</em> series imply clinical duties; <em>In Residence</em> and <em>Adjunct</em> imply research intensity. A prior, not evidence.</td>
</tr>
<tr class="even">
<td><strong>ORCID</strong></td>
<td>works (DOIs → PubMed cross-walk), employment history</td>
<td>Coverage; identity</td>
<td class="n">0.5</td>
<td>Mostly a way to find publications PubMed name-matching missed.</td>
</tr>
<tr class="odd">
<td><strong>Self-declared</strong><br />
onboarding + Edit profile</td>
<td>research focus (existing), <strong>“how I do research” paradigm-family ratings, materials checklist, capabilities checklist, directions I want to move toward, do-not-suggest categories</strong></td>
<td>A C D directly; aspirations</td>
<td class="n">0.9 for current practice · aspiration handled separately</td>
<td>Two minutes of structured self-report resolves most ambiguity for people with thin public records. Contradictions with evidence (declares trials, has none) are surfaced, not silently trusted.</td>
</tr>
<tr class="even">
<td><strong>Directory metadata</strong></td>
<td>department, division, rank, community</td>
<td>Priors for A; career stage</td>
<td class="n">0.3</td>
<td><em>Epidemiology &amp; Biostatistics</em> is a strong population prior; <em>Medicine / Rheumatology</em> is uninformative about paradigm.</td>
</tr>
</tbody>
</table>

### Item classification

Two classifiers run per item, in order. **Rules first.** When structured fields exist — MeSH descriptors, publication types, CT.gov design enums, activity codes, RCDC categories — a deterministic mapping (Appendix B) assigns axis probabilities with high confidence. A paper tagged *Randomized Controlled Trial* + *Humans* + *Adult* is `clinical_trials` at 0.95 and `rct` at 0.95 regardless of what its abstract says about mechanisms. **LLM second.** Items with prose but no structure — abstracts of unindexed papers, RePORTER abstracts, biosketch contributions, Profiles narratives — are classified by a model against the axis schema with a required one-line justification per non-zero axis value. Where both run, rules override the LLM on any axis where the rule fired.

Classification is per item, cached by content hash, and re-run only when the taxonomy version changes. The cost is a one-time pass over roughly 60 publications and 40 grants per person, then incremental.

### Aggregation

// item weight: how much this item should count  
w<sub>item</sub> = reliability(source) × recency(age) × role(item)  
  recency(age) = max(0.15, 0.5<sup>age / 6 yr</sup>)  // half-life six years, never fully forgotten  
  role: first/last/corresponding author 1.0 · middle author 0.5 · contact PI 1.0 · MPI 0.8 · trial PI 1.0 · sub-investigator 0.5  
  
// evidence share per category c on an axis  
share<sub>c</sub> = Σ<sub>items</sub> w<sub>item</sub> · p(c \| item)  /  Σ<sub>items</sub> w<sub>item</sub>  
  
// saturated weight: secondary lines of work stay visible, thin ones stay small  
weight<sub>c</sub> = share<sub>c</sub><sup>0.6</sup>,  capped at 0.30 when fewer than 2 verified items (or 1 grant) support c  
  
// two views  
career view: all items · recent view: items ≤ 5 yr old, same formula  
  
// axis confidence, used by tiering  
confidence = f(Σ w<sub>item</sub>, number of distinct sources) → low / medium / high

The exponent 0.6 is what turns an 80/20 evidence split into weights of roughly 0.87 and 0.38 rather than 0.80 and 0.20 — a clinician-scientist’s translational side-line remains legible to the matcher without being mistaken for the main line. The two-item cap prevents a single collaborative paper from conferring a paradigm. The recent view answers a question strategists ask constantly: *is this still what they do?* A person whose career view says `animal_model 0.7` and whose recent view says `0.15` has moved on, and notices should follow the recent view for Strong fits while career-view strengths remain available as Exploratory.

### Investigator characteristics

career stage  
From rank, title series, year of first R01-equivalent in RePORTER (ESI status estimate), and K-award history. Stored as a stage plus an “ESI eligible until” date where inferable.

mechanisms held  
Set of activity codes ever held as PI, with active/ended and end dates (already computable from `investigator_nih_grants`).

clinical role  
From title series, MD/DO degree in Profiles, and trial registrations. Distinguishes “sees patients” from “studies patients” — both matter for different notices.

PI experience  
Contact-PI count on R01-equivalents; largest award led; multi-PI history. Feeds actionability (§7, stage 7).

collaborative reach  
Co-author network already computed (`investigator_relationships`); community membership; center affiliations. Used to say “would need a collaborator — you have three co-authors who do this” in Exploratory rationales.

aspirations  
Self-declared directions. Never raise a tier above Exploratory; do lower the penalty for a paradigm gap when the aspiration names it.

### Profile record

    {
      "investigator_id": "…",
      "taxonomy_version": "fit-v1",
      "computed_at": "2026-09-04T…",
      "confidence": { "paradigm": "high", "design": "high", "topic": "high", "materials": "medium" },
      "paradigm":   { "career": { "clinical_trials": 0.72, "clinical_observational": 0.61, "translational": 0.34,
                                  "human_biospecimen": 0.31, "molecular_cellular_mechanistic": 0.18 },
                      "recent": { "clinical_trials": 0.81, "clinical_observational": 0.55, "translational": 0.29 } },
      "unit":       { "L3": 0.86, "L4": 0.52, "L1": 0.22 },
      "design":     { "rct": 0.70, "prospective_cohort": 0.58, "early_phase_trial": 0.41, "biospecimen_assay": 0.30 },
      "materials":  { "enrolled_participants": 0.85, "human_blood": 0.40, "ehr": 0.25 },
      "objective":  { "treatment_evaluation_efficacy": 0.78, "biomarker_discovery_validation": 0.40 },
      "topic":      { "mesh_major": ["C20.111.590", "C05.550.114.154"], "rcdc": ["Lupus", "Autoimmune Disease", "Clinical Trials"],
                      "free_text": "B-cell–targeted therapy response in SLE; interferon signatures as predictive biomarkers" },
      "characteristics": { "career_stage": "mid", "esi": false, "mechanisms_held": ["K23", "R01", "U01"],
                           "active_awards": 2, "clinical_role": "md_clinician_investigator", "trial_pi_count": 4 },
      "aspirations": ["implementation_science"],
      "evidence_summary": { "publications_verified": 68, "grants": 9, "trials_as_pi": 4, "biosketch": "on_file" },
      "provenance": [ { "axis": "paradigm", "category": "clinical_trials", "top_items": ["NCT0…", "PMID …", "5U01AR0…"] } ]
    }

*§6 · Answers ask 7*

## Structured opportunity profile

Read the whole solicitation, not the synopsis. Combine what the text says the program wants with what the program has actually funded.

The paradigm requirements of an NIH announcement are rarely in its title or summary. They are in Part 2, Section I — the “Specific Areas of Research Interest” list and the “Non-Responsive” paragraph — in the clinical-trial designation appended to the title, in Section III’s investigator-level eligibility, and, less obviously, in the Scientific/Research Contact of Section VII, whose division tells you whether a diabetes notice comes from a basic-science or a clinical-and-population program. Prospera already downloads this HTML for every NIH notice. It needs to parse it.

### Extraction sources, in order of authority

| Source                          | What it yields                                                                                                                                                                                                                           | How                                                                                                                                                                                                                                                                                                                                                                                                                                     |
|---------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Deterministic notice fields** | Activity code → paradigm and design priors; clinical-trial designation (*Required / Optional / Not Allowed / Basic Experimental Studies with Humans Required*) → design requirement; issuing IC; award ceiling; forecast/reissue lineage | Already stored; add a code→prior table (K23, K24, UG3/UH3, UM1, U01, R34 → clinical; R18 → implementation/health services; K08 → laboratory clinician-scientist; P30/P50/U54 → infrastructure; R21/R03/R01 → neutral; F/T/K → career).                                                                                                                                                                                                  |
| **Full FOA text, by section**   | Paradigm, unit, design (required / allowed / prohibited), materials and data requirements, population requirements, scientific objective, topics, investigator eligibility, team requirements                                            | Parse the Guide HTML into sections (Part 1 Purpose; Section I Background / Research Objectives / Specific Areas of Interest / Non-Responsive; Section II; Section III.3 PD/PI requirements; Section IV clinical-trial and human-subjects items; Section VII contacts). Run a strong LLM extractor per section with a fixed schema; every non-empty field carries a verbatim quote and section reference. No 9,000-character truncation. |
| **Issuing division / program**  | Paradigm prior                                                                                                                                                                                                                           | Section VII Scientific/Research Contact → division (e.g., NCI DCCPS vs. DCB; NHLBI Epidemiology Branch; NIDDK DEM vs. clinical programs). A small curated table of IC divisions → paradigm family.                                                                                                                                                                                                                                      |
| **Funded exemplars (RePORTER)** | Empirical distribution of paradigm, unit, design and topic among projects actually awarded under this announcement or its predecessors                                                                                                   | Query RePORTER by FOA number (and the “reissue of PAR-xx-xxx” lineage from Part 1). Classify each funded project’s abstract with the same item classifier used for investigators. Blend: with ≥ 15 exemplars, 0.6 exemplar / 0.4 text; with 5–14, 0.4 / 0.6; otherwise text only. Not available for new RFAs, which are flagged as text-only.                                                                                           |
| **Non-NIH notices**             | Whatever the synopsis and linked page provide                                                                                                                                                                                            | Same extractor over the Simpler synopsis and `additional_info_url` page. Confidence is capped at *low* or *medium*, which caps tiers at Moderate (§10).                                                                                                                                                                                                                                                                                 |

### Opportunity record

A hypothetical NIDDK mechanism-focused RFA, shown to make the fields concrete.

    {
      "opportunity_id": "…", "number": "RFA-DK-27-0XX", "taxonomy_version": "fit-v1",
      "confidence": "high",                       // full FOA text + 22 funded exemplars from predecessor PAR
      "mechanism": { "activity_code": "R01", "clinical_trial": "not_allowed", "besh": false,
                     "ceiling_direct_per_year": 400000, "period_years": 5, "issuing_ic": "NIDDK",
                     "program_division": "Diabetes, Endocrinology & Metabolic Diseases" },
      "paradigm":   { "required":  { "molecular_cellular_mechanistic": 0.90, "basic_discovery": 0.55 },
                      "allowed":   { "preclinical": 0.70, "human_biospecimen": 0.60, "translational": 0.40 },
                      "excluded":  { "clinical_trials": 1.0, "epidemiology": 0.9, "health_services": 0.9 } },
      "unit":       { "required": ["L1"], "allowed": ["L2", "L3"] },
      "design":     { "required_any": ["wet_lab_experiment", "perturbation"],
                      "allowed": ["animal_in_vivo", "single_cell", "bulk_omics", "biospecimen_assay"],
                      "prohibited": ["rct", "pragmatic_trial", "prospective_cohort", "ehr_analysis"] },
      "materials":  { "expected": ["human islets", "mouse", "iPSC-derived beta cells", "primary cells"], "human_required": false },
      "population": null,
      "objective":  { "mechanism_discovery": 0.9, "target_identification_validation": 0.6 },
      "topic":      { "mesh": ["A03.734.414 Islets of Langerhans", "C18.452.394.750 Diabetes Mellitus Type 2", "G03.495 Insulin Secretion"],
                      "rcdc": ["Diabetes"], "free_text": "beta-cell stress responses, dedifferentiation, islet–immune crosstalk" },
      "eligibility": { "investigator_rules": [], "esi_only": false, "clinician_required": false },
      "team": { "multi_pi_allowed": true, "consortium_required": false },
      "non_responsive": [ "clinical trials", "epidemiologic or observational cohort studies", "health services research",
                          "studies limited to type 1 diabetes autoimmunity" ],
      "provenance": { "paradigm.required": { "section": "Part 2 · Section I · Research Objectives",
                      "quote": "…applications must propose mechanistic studies of beta-cell…" } }
    }

Why exemplars matter

Most NIH volume is reissued PAs and PARs. For those, RePORTER holds dozens of funded projects under the same number. Their abstracts, classified the same way as an investigator’s papers, say more about what the program funds than any synopsis — and they update themselves every council round. A notice whose text reads as “translational” but whose funded portfolio is 90% mouse mechanism should be matched to the portfolio.

*§7 · Answers ask 9*

## Pipeline architecture

Gates first, on structure; ranking second, on text; judgment last, on the short-list. Each stage does the one thing it is good at, and every stage leaves a component score behind for the explanation.

The pipeline runs per investigator (the investigator page and nightly digests) and per notice (Outreach recipients) over the same profiles and the same functions, so the three surfaces finally agree. The figure shows a typical run for one investigator against the open-notice corpus.

*Figure: Stages 1–4 remove or cap: a notice whose paradigm, unit or required design the investigator has never worked in does not reach the ranking. Stages 5–7 order the survivors and are additive. Stage 8 sees only the top of that order, with the structured profiles and cited evidence, and may lower a tier freely but raise one only by a single step with a quoted reason. Stage 9 turns component scores into a tier by floors (§10). Counts are illustrative.*

### Stage specifications

**1**gate

#### Eligibility hard filter

**Inputs.** Notice eligibility rules (Section III.3 and the extractor’s `eligibility` block); investigator career stage, degrees, appointment, citizenship where the notice requires and Prospera knows it; do-not-contact; deadline runway.

**Rule.** Fail on any rule Prospera can evaluate with confidence: ESI-only when the investigator has held an R01-equivalent; MD/DO required when the investigator is PhD-only; independent appointment required for trainees; deadline already passed. Unknown is *not* fail — it becomes a flag that caps the tier at Moderate and appears in the rationale (“ESI status not on file”).

**Output.** E ∈ {0, 1}, flags\[\]. Extends the existing `eligibility()` in `suggest.ts`.

**2**gate

#### Research-paradigm compatibility gate + score

**Inputs.** Investigator paradigm weights (recent view, falling back to career view when recent evidence is thin); notice required / allowed / excluded paradigms; family matrix (§4).

**Rule.** For each required paradigm *o* with weight *w<sub>o</sub>*, support = max over investigator paradigms *i* of *w<sub>i</sub>* · compat(*i*, *o*). P = weighted mean of support. If the investigator’s dominant paradigm (weight ≥ 0.6) is in the notice’s excluded set and no required paradigm has support ≥ 0.4, P := min(P, 0.15). P \< 0.25 caps the tier at Poor; P \< 0.45 caps at Exploratory. Cross-cutting paradigms (computational, methods) skip the matrix and take P from stages 3–4.

**Output.** P, the best-supporting paradigm pair, and the excluded-paradigm hit if any.

**3**gate

#### Unit-of-analysis compatibility gate + score

**Rule.** Same form over the five-level matrix. U \< 0.20 caps at Poor. Partly redundant with paradigm by design: it catches the cases paradigm misses, such as a “clinical” notice that actually wants patient-level phenotyping versus a “clinical” investigator whose work is registry-scale.

**Output.** U, best-supporting level pair.

**4**gate

#### Study-design compatibility gate + score

**Rule.** D = 0.6 · *req* + 0.3 · *allowed* + 0.1 · (1 − *prohibited*), where *req* is the minimum, over the notice’s required design groups, of the investigator’s maximum support inside that group (any-of within a group, all-of across groups); *allowed* is the share of the investigator’s design mass inside the notice’s allowed set; *prohibited* is the share inside its prohibited set. A required group with support \< 0.20 caps at Exploratory — this is the “Clinical Trial Required, no trial evidence” rule. A prohibited design that dominates the investigator’s work (share ≥ 0.6) is a penalty, not a gate: a trialist may also do observational work.

**Output.** D, the unmet requirement if any, the dominant prohibited design if any.

**5**rank

#### Scientific-topic alignment score

**Inputs.** Notice topic codes and free text; investigator topic codes and the *subset of evidence items whose paradigm and design are compatible with the notice*.

**Rule.** T = 0.5 · coded overlap + 0.3 · item-level embedding similarity + 0.2 · BM25. Coded overlap compares MeSH and RCDC codes weighted by tree depth and inverse document frequency over the notice corpus, so *Neoplasms* is worth little and *Cholangiocarcinoma* a lot. Embedding similarity is the mean of the top three cosines between the notice’s topic text and compatible items, rescaled from the \[0.35, 0.65\] band — computed per item, never against the career vector. BM25 runs the notice’s distinctive terms against the compatible items’ text.

**Why compatible-only.** A clinician’s single mouse paper cannot carry a mechanistic RFA’s topic score, because it is excluded from the topic computation for that notice. This one restriction removes most of the “same disease, wrong kind of work” inflation on its own.

**6**rank

#### Methods and capability alignment score

**Rule.** M = share of the notice’s required methods and capabilities with investigator evidence ≥ 0.3, blended with infrastructure fit (biobank, clinical research center, cohort access, data enclave, animal facility) where the notice names it. Institutional infrastructure UCSF is known to have counts as 0.5 rather than 0 or 1.

**7**rank

#### Track record and actionability score

**Rule.** K (track record) from mechanism readiness — has held this tier or the one below (K → R21/R03 → R01 → U01/P01) — relevant active awards, and prior UCSF awardees under the same activity code. A (actionability) from deadline runway (≥ 6 weeks for an R01-scale application, ≥ 3 for an R21), LOI feasibility, not already in the Outreach pipeline, not dismissed by this investigator within 12 months, and a load heuristic (≥ 3 active R01-equivalents lowers A). Role matters: trial experience only as a site sub-investigator halves the credit for “can lead a trial”.

**8**judge

#### LLM holistic adjudication short-list only

**Three passes, detailed in §16.** A *blind holistic pass* reads the top evidence items and the notice’s Section I, non-responsive and eligibility text — never the structured score — and must judge paradigm, unit and design before topic, then give a categorical verdict with cited evidence IDs. A *skeptic pass* argues, from the same inputs, why the application would be triaged as non-responsive. An *informed reconciliation* then sees everything and explains any disagreement.

**Authority.** Either the structure or the model can lower a tier with grounded evidence; both must agree for Strong. The model never emits a score and never overrides one directly: to raise, it must name the specific input it believes the structure got wrong — an unparsed trial role, a misread notice requirement — and the structured score is recomputed with that correction. Insights no correction can express go to Exploratory with the rationale, and to a strategist review queue. Run only for the top ~15 candidates per investigator (or per notice), with a strong model, cached by (profile versions, notice version).

**9**calib

#### Confidence calibration and tier floors

**Rule.** Compute S (§8) for ordering. Assign the tier by the conjunctive floors in §10, then apply caps from stages 1–4, the confidence caps (low-confidence investigator or notice profile → Moderate at most), and the stage-8 verdict. Emit the rationale from component provenance: which paradigm pair, which design, which evidence items, which unmet floor.

**Calibration.** Once strategist labels exist (§14), fit the floors and the family/level matrices so that ≥ 85% of Strong and ≥ 70% of Moderate are judged appropriate; report precision per tier on the dashboard.

*§8 · Answers ask 10*

## Scoring framework

Multiply where a veto is semantically justified; add where trade-offs are legitimate. Order by the score; label by floors.

The brief asks whether paradigm compatibility should carry 20–25% of an additive score. It should not carry a percentage at all, because any additive weight can be outvoted: with paradigm at 25%, a 0.95 topic score and full marks elsewhere still yield about 0.80 for an investigator whose paradigm compatibility is 0.20. The only way to make “a disease match cannot overcome a paradigm mismatch” true by construction is to make paradigm a factor, not a term. Pure multiplication across all dimensions is the opposite mistake: seven factors of 0.8 multiply to 0.21, everything compresses toward zero, and the number stops meaning anything a strategist can explain. The design uses each form where it belongs.

// compatibility factor — vetoes, multiplicative  
C = E · P · D<sup>0.75</sup> · U<sup>0.5</sup>  
  E eligibility ∈ {0, 1} · P paradigm · D design · U unit, each ∈ \[0, 1\]  
  exponents: paradigm has full veto power; design nearly full; unit is half-redundant with paradigm and tempered  
  
// relevance — trade-offs, additive  
R = 0.40 · T + 0.20 · M + 0.15 · O + 0.15 · K + 0.10 · A  
  T topic · M methods/capabilities · O objective · K track record · A actionability  
  
// composite, for ordering only  
S = 100 · C · R  
  
// worked: 0.95 topic, 0.20 paradigm, everything else perfect  
C = 1 · 0.20 · 1 · 1 = 0.20   R = 0.40·0.95 + 0.20 + 0.15 + 0.15 + 0.10 = 0.98   **S = 19.6** → Poor  
// worked: 0.55 topic, 0.90 paradigm, 0.85 design, 0.80 unit, others 0.7  
C = 0.90 · 0.85<sup>0.75</sup> · 0.80<sup>0.5</sup> = 0.90 · 0.885 · 0.894 = 0.712   R = 0.22 + 0.14 + 0.105 + 0.105 + 0.07 = 0.64   **S = 45.6** → Moderate if floors allow

Topic is 40% of R — the largest additive term, larger than the brief’s 20–25% — and that is deliberate: once a notice has passed the gates, the most useful ordering among survivors *is* topical, and a topic score that is computed only over paradigm-compatible evidence is no longer the inflated quantity it is today. The effective influence of paradigm, unit and design is not a percentage; it is a ceiling on everything else.

Two further properties matter. **S orders; it does not label.** Tiers come from floors (§10), so two candidates at S = 62 can be Moderate and Exploratory if one of them misses a methods floor. **Every term is explainable** because every term is derived from named evidence: the UI can render “Paradigm 0.88 — clinical_trials (yours 0.81) vs. required clinical_trials · Design 0.90 — rct required, 11 RCT publications and 4 registered trials as PI · Topic 0.61 — SLE, B-cell therapy; 3 compatible items above 0.52”.

| Term | Range and source          | Behavior                                           | Why this form                                                                                            |
|------|---------------------------|----------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| E    | {0,1} · stage 1           | Zero removes the candidate                         | Eligibility is binary where known; unknowns are flags, not fractions.                                    |
| P    | \[0,1\] · stage 2         | Factor; caps at \< .25 / \< .45                    | The brief’s core requirement: disease match must not overcome paradigm mismatch.                         |
| D    | \[0,1\] · stage 4         | Factor^0.75; unmet requirement caps at Exploratory | Design requirements are explicit in notices and testable in evidence; nearly a veto.                     |
| U    | \[0,1\] · stage 3         | Factor^0.5                                         | Catches paradigm’s misses without double-counting its hits.                                              |
| T    | \[0,1\] · stage 5         | 0.40 of R                                          | The right ordering among compatible candidates; computed on compatible evidence only.                    |
| M    | \[0,1\] · stage 6         | 0.20 of R; Strong floor 0.5                        | Missing capabilities are real gaps but often fillable by collaborators — so a term, with a floor.        |
| O    | \[0,1\] · item classifier | 0.15 of R                                          | Objective mismatch (mechanism lab vs. treatment-evaluation notice) is informative but not disqualifying. |
| K    | \[0,1\] · stage 7         | 0.15 of R; Strong floor 0.4                        | Readiness for the mechanism; protects against suggesting P01s to first-time applicants.                  |
| A    | \[0,1\] · stage 7         | 0.10 of R                                          | Runway and load; “realistically actionable” in the Strong definition.                                    |

*§9 · Answers ask 8*

## Mismatch penalties and hard gates

Negative evidence deserves the weight the current engines give to nothing. The question for each mismatch is whether it should remove the notice, cap its tier, or subtract from its score — and the answer depends on whether a collaborator could plausibly fix it.

The guiding rule: **exclude** when the investigator is ineligible or the notice prohibits what they do; **cap at Poor** (hidden by default, visible on request) when the paradigm or unit is fundamentally different; **cap at Exploratory** when the gap is a capability that a collaborator or a new direction could supply; **penalize** when the mismatch is a matter of emphasis.

| Mismatch                                                                                           | Detected by                                                                       | Treatment                                                                                                                                                   | Rationale                                                                                                                                                                                       |
|----------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Basic molecular investigator → population epidemiology notice                                      | P: family 1 vs 5 = 0.05; U: L1 vs L4 = 0.10                                       | Cap Poor                                                                                                                     | Different science. No collaborator makes a mechanist a cohort epidemiologist; shared disease vocabulary is noise here.                                                                          |
| Epidemiologist → wet-lab mechanistic notice                                                        | P: 5 vs 1; D: required wet_lab support ≈ 0                                        | Cap Poor                                                                                                                     | Symmetric to the above.                                                                                                                                                                         |
| Clinical trialist → animal-model-only notice                                                       | D: required animal_in_vivo unmet; materials: no non-human                         | Cap Poor                                                                                                                     | The notice states the system; the investigator has never used it.                                                                                                                               |
| Population researcher → cellular mechanism notice                                                  | P 5 vs 1; U L4 vs L1                                                              | Cap Poor                                                                                                                     | As above.                                                                                                                                                                                       |
| Laboratory investigator → health-services delivery notice                                          | P 1/2 vs 6 = 0.05                                                                 | Cap Poor                                                                                                                     | As above.                                                                                                                                                                                       |
| Basic scientist → “Clinical Trial Required” notice                                                 | Title designation → required `rct/early_phase_trial`; support ≈ 0                 | Cap Poor, or Exploratory if translational weight ≥ 0.4 and a trialist co-author exists | A trial requirement is a design fact, not a topic. The exception is a translational scientist with a clear path to a clinical partner — the rationale names the partner.                        |
| Clinical investigator → fundamental mechanism RFA in their disease                                 | P 4 vs 1 = 0.15; D wet_lab unmet                                                  | Cap Poor; Exploratory if human_biospecimen ≥ 0.4 and notice allows human tissue        | The user’s diabetes example. Patient-facing work is not beta-cell biology. If they also run a translational lab on human islets, that part of their profile may legitimately reach Exploratory. |
| Clinical observational researcher → implementation-science notice without implementation evidence  | P 4 vs 6 = 0.50; D hybrid/implementation_evaluation unmet                         | Cap Exploratory                                                                                                       | Adjacent field, learnable, often done with an implementation-science collaborator; the rationale says so.                                                                                       |
| Computational investigator → notice requiring experimental intervention capability                 | D: required wet_lab / animal_in_vivo unmet; M: intervention capability absent     | Cap Exploratory (“as computational collaborator”)                                                                     | They cannot lead it; they may be exactly the co-investigator it needs. Surface it as such.                                                                                                      |
| Disease keyword overlap, no work in the required paradigm                                          | T high, P \< 0.25                                                                 | Cap Poor                                                                                                                     | The defining failure mode of the current engine; handled by the gate, not by a penalty.                                                                                                         |
| Patient recruitment required, no human-subjects evidence                                           | Materials: enrolled_participants = 0; D prospective/rct = 0; no IRB-type language | Cap Poor                                                                                                                     | Recruitment infrastructure is not something a lab acquires for one application.                                                                                                                 |
| Notice prohibits the investigator’s dominant design (e.g. “clinical trials not allowed”, trialist) | D: prohibited share ≥ 0.6                                                         | Penalty (D × 0.7) + flag                                                                                                                                    | They may well do observational or biomarker work; the notice constrains the application, not the person.                                                                                        |
| Objective mismatch (mechanism lab vs treatment-evaluation objective)                               | O low                                                                             | Penalty via R only                                                                                                                                          | Informative for ordering; not a reason to hide.                                                                                                                                                 |
| ESI-only notice, established investigator                                                          | Stage 1                                                                           | Exclude                                                                                                                    | Ineligible.                                                                                                                                                                                     |
| MD required, PhD-only investigator                                                                 | Stage 1                                                                           | Exclude                                                                                                                    | Ineligible.                                                                                                                                                                                     |
| Mechanism far above readiness (P01/U54 to an investigator with no R01)                             | K low                                                                             | Cap Moderate; flag “consider as project lead, not PI”                                                                                                       | Not impossible, but Strong would mislead.                                                                                                                                                       |
| Deadline runway \< 3 weeks (R01 scale)                                                             | A low                                                                             | Cap Moderate; show next cycle if the notice has one                                                                                                         | Not actionable this cycle; the receipt-cycle data Prospera already has answers “when is the next one”.                                                                                          |
| Self-declared “do not suggest” category                                                            | Profile                                                                           | Exclude                                                                                                                    | The investigator’s explicit instruction.                                                                                                                                                        |

*§10 · Answers ask 11*

## What “Strong fit” means

A tier is a set of floors, not a threshold on one number. Strong requires all of them; Moderate allows one meaningful gap; Exploratory names the gap; Poor is hidden but explainable.

The intended reading of Strong is the brief’s sentence: *scientifically relevant, appropriate for the investigator’s type of research, compatible with their capabilities and career stage, and realistically actionable*. Each clause maps to a floor.

| Floor           | Strong fit       | Moderate fit                    | Exploratory                                                         | Poor · hidden |
|-----------------|---------------------------------------------------|--------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|----------------------------------------------|
| E eligibility   | pass, no unknowns                                 | pass; unknown flags allowed                                        | pass                                                                                                      | pass (fail = excluded, never shown)          |
| P paradigm      | ≥ 0.75                                            | ≥ 0.50                                                             | ≥ 0.25, or ≥ 0.45 with aspiration match                                                                   | \< 0.25                                      |
| U unit          | ≥ 0.60                                            | ≥ 0.40                                                             | ≥ 0.20                                                                                                    | \< 0.20                                      |
| D design        | ≥ 0.75; every required group supported ≥ 0.4      | ≥ 0.50; every required group supported ≥ 0.2                       | a required group unsupported is allowed here — this is what Exploratory is for                            | —                                            |
| T topic         | ≥ 0.60, with ≥ 1 specific (depth ≥ 3) coded match | ≥ 0.45                                                             | ≥ 0.35                                                                                                    | —                                            |
| M methods       | ≥ 0.50                                            | ≥ 0.30                                                             | any                                                                                                       | —                                            |
| K track record  | ≥ 0.40 (mechanism within one tier of readiness)   | ≥ 0.25                                                             | any                                                                                                       | —                                            |
| A actionability | runway sufficient; not in pipeline                | any                                                                | any                                                                                                       | —                                            |
| confidence      | investigator and notice profiles ≥ medium         | any                                                                | any                                                                                                       | —                                            |
| stage 8 verdict | confirm (a lower verdict drops the tier)          | confirm or raise-from-Exploratory                                  | —                                                                                                         | —                                            |
| S (ordering)    | typically ≥ 65                                    | typically 45–65                                                    | typically 25–45                                                                                           | typically \< 25                              |
| gaps allowed    | none                                              | exactly one Strong floor missed, and not P, U or a required design | the rationale must name the gap and, where possible, the fix (collaborator, cohort access, new direction) | shown only under “Why not?”                  |

S ranges are descriptive, not definitional: a candidate with S = 70 and an unmet methods floor is Moderate. Floors are the initial values to be calibrated in §14.

**Exploratory is a feature, not a consolation prize.** It is where recall lives: “scientifically interesting; would require a trialist collaborator” is a useful thing to tell a research-development office, and it is precisely the kind of lead an RD strategist can act on by introducing two people. The current engines have no way to say it, so they either promote the lead to a recommendation or lose it. The UI should present Exploratory under its own heading, below the recommendations, with the gap sentence as the first line.

**Poor is hidden but never deleted.** A strategist asking “why isn’t Dr. X suggested for this?” should get the answer — “paradigm: epidemiology vs. required molecular mechanism (0.05); design: wet-lab experiments required, none in 68 publications” — on demand. That transparency is what builds trust in the short list.

*§11 · Generic scientific language*

## Keeping generic language from inflating scores

“Immune”, “cancer”, “inflammation”, “data” and “clinical” should earn almost nothing on their own. Five mechanisms, layered, make that true without a hand-maintained stop list.

1.  **Code, don’t string-match.** Topic overlap is computed on MeSH tree numbers and RCDC categories, weighted by *tree depth*: *Neoplasms* (C04) is depth 1 and nearly worthless; *Cholangiocarcinoma* (C04.557.470.200.025.390) is depth 6 and decisive. A Strong topic score requires at least one coded match at depth ≥ 3.
2.  **Inverse document frequency over the notice corpus.** Every term and code is weighted by how many open notices contain it. “Cancer” appears in a large share of NCI notices and is discounted automatically; “ferroptosis” is not. This replaces the current `GENERIC_WORDS` list, which is both incomplete (it lacks *immune*, *cancer*, *inflammation*) and destructive (it deletes paradigm words).
3.  **Route paradigm words to the paradigm axis.** *Clinical*, *preclinical*, *in vivo*, *cohort*, *randomized* stop being topic tokens and become evidence for axes A–C, where they belong. The words are not generic; they were being asked the wrong question.
4.  **Topic similarity only over compatible evidence.** Embedding and BM25 similarity are computed between the notice and the investigator’s paradigm-compatible items, never the whole career (§7, stage 5). A shared disease word in an incompatible paper never enters the computation.
5.  **Specificity in the extractor.** The opportunity extractor already refuses filler (“disease mechanisms”, “novel therapeutic strategies”). Extend the rule: any facet term whose IDF-weighted score is below a threshold is dropped, and the extractor is asked for the notice’s *distinguishing* terms explicitly — what would separate a responsive application from a non-responsive one.

The effect on the brief’s example: “both involve asthma” yields a depth-3 coded match (*Asthma*, C08.127.108) worth a moderate topic contribution — and nothing else, because the molecular immunologist’s paradigm compatibility with an epidemiologic RFA is 0.05 and the topic is computed over zero compatible items. The pair lands in Poor, with the asthma overlap named in the “Why not?” explanation as the thing that did not help.

*§12 · Feedback loop*

## Feedback loop

Treat “wrong type of research” as a first-class signal, route it to the axis it names, and do not train anything end-to-end until a few hundred labeled pairs exist.

Prospera already records dismissals with reasons (`not_relevant`, `wrong_area`, `wrong_person`, `already_aware`, `do_not_contact`), pipeline stages, PI replies, submissions and outcomes. What it lacks is a reason that names paradigm, and any path from a signal back into the model.

| Signal                                                                                                                                                                                                                              | Strength    | Immediate use                                                                                                                                   | Model use                                                                             |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|-------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| Impression without click (shown ≥ 3 times)                                                                                                                                                                                          | weak        | None — position and habit confound it                                                                                                           | Negative-lite label in LTR only when paired with a dismissal elsewhere                |
| Click / peek open                                                                                                                                                                                                                   | weak        | None                                                                                                                                            | Ordering feature within tier                                                          |
| Save / watch / add to calendar                                                                                                                                                                                                      | medium      | Lift ordering of near-duplicates for this person                                                                                                | Positive label (Moderate or better)                                                   |
| Dismiss — *not relevant*                                                                                                                                                                                                            | medium      | Suppress for 12 months                                                                                                                          | Negative label                                                                        |
| Dismiss — **wrong type of research** new with sub-reason: *I don’t run trials · this is lab work · this is population research · wrong model system · I don’t do implementation · wrong data type* | strong      | Suppress; propose a profile correction (“lower `clinical_trials` from 0.35 to 0.15?”) that the investigator or strategist confirms in one click | Highest-value label: it names the axis, so it trains the gate rather than the ranking |
| Dismiss — *wrong career stage / not eligible* new                                                                                                                                                  | strong      | Correct characteristics (ESI, degree, appointment)                                                                                              | Eligibility rule audit                                                                |
| Dismiss — *already aware*                                                                                                                                                                                                           | neutral     | Suppress this notice only                                                                                                                       | Treated as positive relevance, negative novelty                                       |
| Shared to PI; PI replies *interested / maybe / not now*                                                                                                                                                                             | strong      | Existing Outreach flow                                                                                                                          | Interested = positive; not now with note = mined for paradigm language                |
| Grant-writing support requested                                                                                                                                                                                                     | strong      | —                                                                                                                                               | Positive (Strong-quality)                                                             |
| Application submitted                                                                                                                                                                                                               | very strong | —                                                                                                                                               | Gold positive; also updates track record K                                            |
| Award received                                                                                                                                                                                                                      | gold        | —                                                                                                                                               | Gold positive; sparse and 9–18 months lagged, so it validates rather than trains      |
| Strategist tier override (agree / should be higher / should be lower, with reason)                                                                                                                                                  | gold        | Override persists for that pair                                                                                                                 | The primary calibration label (§14)                                                   |

### How signals flow back

**Immediately, per investigator.** Suppressions and confirmed profile corrections take effect on the next page load. A “wrong type of research” dismissal that names an axis becomes a proposed edit to that axis weight, shown to the investigator (or the strategist acting for them) as a one-click confirmation. Corrections are recorded with provenance and override inferred weights on that axis for 24 months, then decay back toward evidence.

**Periodically, globally.** Every quarter, or whenever ≥ 50 new tier labels accumulate, recalibrate the floors in §10 and the family/level matrices in §4 against the label set: the target is that ≥ 85% of Strong and ≥ 70% of Moderate labels agree with the strategist. This is a handful of parameters fit to a few hundred labels — a spreadsheet-scale problem, deliberately.

**Eventually, learning-to-rank.** When ≥ 300–500 labeled pairs exist, fit a pairwise model (logistic or LambdaMART) over the ten component scores plus a few interactions, to learn the ordering within tiers. Do not learn from raw text: the components *are* the explanation, and a model over them stays auditable. Gates remain rule-based; the model orders survivors.

**What not to do.** Do not learn from clicks alone (position bias dominates); do not let awards drive weights (too sparse, too slow); do not let one investigator’s dismissals move global parameters (they move that investigator’s profile).

*§13 · Answers ask 12*

## Adversarial cases

Nine pairs designed to expose the difference between “same disease” and “same kind of research”, scored three ways. Cosine values are estimates for `text-embedding-3-small` in the band typical of same-disease pairs, not measurements; component scores are what the proposed rules produce for the described profiles.

*Figure: Where the cases fall. The current engine’s only axis is the horizontal one: cases 1, 2, 3, 6b and 7a sit inside its recommendation band and are Poor or Exploratory under the redesign; case 4 sits outside the band and is a Moderate fit under the redesign. Green points are Strong or Moderate; amber Exploratory; red Poor.*

Investigator

Basic tumor immunologist

Molecular mechanisms of T-cell exhaustion in mouse tumor models; single-cell RNA-seq; 41 verified papers, R01 from NCI Division of Cancer Biology. Paradigm: mechanistic 0.85, animal_model 0.75, human_biospecimen 0.20. Unit: L1 0.85, L2 0.70. Design: perturbation, animal_in_vivo, single_cell.

Opportunity

Population epidemiology of cancer survivorship disparities

NCI DCCPS R01, Clinical Trial Not Allowed. Requires population cohorts or registry/claims linkage; social determinants; survivorship outcomes. Paradigm required: epidemiology, population_health. Unit: L4. Design: prospective/retrospective cohort, linked administrative data, survey.

Keyword overlap

Match

Hits on *cancer*, *immune*, *patients*, *outcomes*, *survivors* (the mouse papers mention patient relevance in every abstract).

Current embedding engine

Potential match

Estimated cosine 0.46–0.50. Two supporting items from two kinds are likely (immunotherapy papers + the R01 abstract), so the investigator page could show *Strong match*.

Proposed

Poor · hidden

Paradigm gate. S ≈ 2.

E **1**P **0.05** · fam 1/2 vs 5U **0.10** · L1/L2 vs L4D **0.04** · cohort/RWD required, noneT **0.30** · coded only, 0 compatible itemsM **0.05**K **0.6**

Why notPopulation epidemiology and registry linkage are required; this investigator’s 41 publications are molecular and animal-model work with no human-subjects, cohort or administrative-data evidence. Shared cancer vocabulary did not count.

Investigator

Cardiovascular epidemiologist

CVD incidence and risk factors using EHR and longitudinal cohorts (MESA-style); causal inference. Paradigm: epidemiology 0.90, population_health 0.60, clinical_observational 0.45. Unit: L4 0.90. Design: prospective_cohort, ehr_analysis, causal_inference.

Opportunity

Cellular mechanisms of cardiomyocyte mitochondrial dysfunction

NHLBI R01 basic. Requires wet-lab mechanistic studies in cardiomyocytes, iPSC-CMs or animal models. Paradigm required: molecular_cellular_mechanistic. Unit: L1. Design: wet_lab, perturbation, animal_in_vivo allowed. Non-responsive: observational human studies.

Keyword overlap

Match

*Heart failure*, *cardiovascular*, *myocardial*, *risk*.

Current embedding engine

Potential / Exploratory

Estimated cosine 0.42–0.47. Shown, with a “why” line citing a heart-failure incidence paper.

Proposed

Poor · hidden

Paradigm and design gates; the notice’s non-responsive list names her design. S ≈ 2.

E **1**P **0.05** · fam 5 vs 1, excluded hitU **0.10**D **0.00** · wet_lab requiredT **0.35**M **0.0**

Why notWet-lab mechanistic studies are required and observational human studies are listed as non-responsive; all evidence is cohort and EHR analysis.

Investigator

IBD clinical trialist

PI on four interventional trials in Crohn’s and ulcerative colitis; K23 then R01; 60 papers, mostly RCTs and treatment-response cohorts. Paradigm: clinical_trials 0.85, clinical_observational 0.60, human_biospecimen 0.30. Unit: L3 0.9, L4 0.4. Design: rct, prospective_cohort, biospecimen_assay.

Opportunity

Genome-wide population study of environmental determinants of IBD incidence

NIDDK/NIEHS R01, Clinical Trial Not Allowed. Requires large population cohorts or biobanks, GWAS or gene–environment analysis, exposure assessment. Paradigm required: genetic_epidemiology, epidemiology. Unit: L4. Design: gwas, cohort, exposure_assessment.

Keyword overlap

Strong

Dense overlap: *IBD*, *Crohn’s*, *colitis*, *incidence*, *patients*.

Current embedding engine

Strong match

Estimated cosine 0.52–0.56 — IBD-dense text on both sides; supporting items from PubMed and RePORTER. Ranked near the top of her list.

Proposed

Exploratory

Adjacent paradigm, required designs unmet. S ≈ 6 — ordered below every Moderate, shown under its own heading with the gap named.

E **1**P **0.45** · fam 4 vs 5U **0.55** · L3 vs L4D **0.13** · gwas/exposure required, none; rct prohibitedT **0.80**M **0.20** · no genomic-analysis evidenceK **0.6**

GapStrong topical fit, but the notice funds population genetic epidemiology and prohibits trials. Realistic as a clinical co-investigator providing phenotyped cohorts; a Strong fit would need a genetic-epidemiology lead. Two co-authors in the directory have GWAS publications.

Investigator

Computational statistical geneticist

Methods for polygenic risk and ancestry-aware GWAS in biobank data; no disease focus; 35 papers, R01 from NHGRI. Paradigm: computational_data_science 0.9, genetic_epidemiology 0.7, bioinformatics 0.6. Unit: L4 0.85 (population genomic data), L1 0.5 (genome). Design: secondary_data_analysis, gwas, ml_model_development.

Opportunity

Large-scale human genomic analysis of chronic kidney disease progression

NIDDK R01. Requires analysis of existing biobank/cohort genomic data with clinical outcomes; encourages methods for diverse ancestries. Paradigm: genetic_epidemiology, computational. Unit: L4. Design: secondary_data_analysis, gwas. Topic: CKD, eGFR decline, APOL1.

Keyword overlap

No match

No kidney terms anywhere in the investigator’s record.

Current embedding engine

Exploratory or dropped

Estimated cosine 0.38–0.43: the notice text is kidney-heavy, the career vector is methods-heavy. Below or at the exploratory floor.

Proposed

Moderate fit

Every structural axis aligns; topic specificity to kidney disease is the one gap. S ≈ 55.

E **1**P **0.91** · cross-cutting, from U and DU **0.90**D **0.92**T **0.55** · methods terms match; CKD codes absentM **0.90**O **0.70**K **0.6**

GapThe notice wants exactly this kind of analysis on exactly this kind of data. What is missing is kidney-disease context; a nephrology cohort PI as co-investigator would make this Strong.

Investigator

Lupus clinical trialist

The profile record in §5: K23 → R01 → U01 network; PI on four interventional SLE trials; interferon-signature biomarker work. Paradigm: clinical_trials 0.81 (recent), clinical_observational 0.55, translational 0.29.

Opportunity

Novel therapeutics in systemic lupus — Clinical Trial Required

NIAMS R01, Clinical Trial Required. Phase II mechanistic or efficacy trials of targeted agents in SLE; biomarker-guided designs encouraged. Paradigm: clinical_trials. Unit: L3. Design: rct or early_phase_trial required; biospecimen_assay allowed.

Keyword overlap

Strong

*Lupus*, *SLE*, *clinical trial*, *biomarker*.

Current embedding engine

Strong match

Estimated cosine 0.55+. Correct — but the same engine also labels the mouse-model lupus lab down the hall Strong for this notice.

Proposed

Strong fit

All floors met, stage 8 confirms. S ≈ 69.

E **1**P **1.00**U **1.00**D **0.79** · rct 0.70, 4 trials as PIT **0.85** · C20.111.590 depth 3M **0.80**O **0.85**K **0.70**A **0.90**

WhyTrial required; four registered interventional SLE trials as PI and eleven RCT publications since 2019. Biomarker-guided design encouraged; three interferon-signature papers. R01 held; 11 weeks to receipt date.

Investigator

Basic human immunologist

T-cell receptor signaling in *human* primary T cells from healthy donors and patient blood; no animal work; CRISPR perturbation, phospho-flow, scRNA-seq. Paradigm: mechanistic 0.85, human_biospecimen 0.60, translational 0.45. Unit: L1 0.9 with human materials. Design: wet_lab, perturbation, single_cell.

Two opportunities

6a · Mechanistic immunology, Basic Experimental Studies with Humans Required  ·  6b · CAR-T cell therapy trial, Clinical Trial Required

6a (NIAID R01 BESH): mechanistic studies in human participants or specimens; wet-lab designs. 6b (NCI R01 CTR): phase I/II CAR-T trials in hematologic malignancy; correlative science encouraged.

Keyword / embedding, both notices

Strong for both

Same T-cell vocabulary; estimated cosine 0.55 for 6a and 0.56 for 6b. The current engines cannot tell these two notices apart for this person.

Proposed · 6a BESH

Strong fit

P 0.90 (fam 1 vs 1/3), U 0.90 (L1 with human materials meets the human requirement), D 0.90 (wet_lab; human_blood 0.7), T 0.80. S ≈ 66.

Proposed · 6b CAR-T trial

Exploratory

P 0.15 would cap at Poor, but translational 0.45 and two trialist co-authors trigger the exception in §9. D: rct unmet. S ≈ 7.

Gap · 6bA clinical trial is required and this investigator has led none; the correlative-science aims are a natural fit. Realistic as correlative-science lead with a trialist PI — Dr. — and Dr. — in the directory run CAR-T trials.

Investigator

Health services researcher

Claims- and EHR-based studies of diabetes care quality, utilization and disparities; one hybrid effectiveness-implementation study as co-I. Paradigm: health_services 0.85, outcomes_research 0.6, population_health 0.5, implementation_science 0.30. Unit: L5 0.7, L4 0.7. Design: claims_analysis, ehr_analysis, retrospective_cohort, hybrid 0.35.

Two opportunities

7a · Mechanisms of beta-cell dysfunction (the §6 record)  ·  7b · Implementing the Diabetes Prevention Program in community health centers

7a: NIDDK R01, wet-lab required. 7b: NIDDK R18 dissemination and implementation; hybrid designs and implementation outcomes required; FQHC partnerships.

Keyword / embedding

Potential for both

*Diabetes* everywhere. Estimated cosine 0.44 (7a) and 0.50 (7b); the current engine shows both, and cannot say which is the real lead.

Proposed · 7a beta-cell

Poor · hidden

P 0.05 (fam 6 vs 1), U 0.05, D 0.00. S ≈ 1.

Proposed · 7b DPP implementation

Moderate fit

P 0.85 (sibling categories), U 1.0, D 0.55 (hybrid support 0.35 meets the 0.2 requirement floor; below the 0.75 Strong floor), T 0.70, M 0.60. S ≈ 36. One gap: implementation-design depth.

Gap · 7bHealth services → implementation science is an adjacent move this investigator has started (one hybrid study). The notice requires implementation outcomes; pairing with an implementation scientist would make this Strong. Deadline in 9 weeks.

Across the nine pairs, the current engine recommends seven and ranks the one genuinely under-served lead (case 4) at or below its exploratory floor. The redesign recommends four — 5, 6a, 7b as recommendations, 4 as a Moderate with a named gap — surfaces 3 and 6b as Exploratory with the collaborator it would take, and hides 1, 2 and 7a with an explanation available on request. That is the precision-for-recall trade the brief asks for, and it is achieved without any of the pairs being decided by cosine similarity.

*§14 · Answers ask 13*

## Evaluation protocol

Measure precision at the top, per tier, against strategist judgment — and keep the adversarial pairs as regression tests so the gates can never quietly regress.

### Gold set

Two hundred investigator–notice pairs, labeled by two RD strategists with a third to adjudicate disagreements. Stratified so the set cannot be gamed: 80 pairs drawn from what the *current* engines label Strong or Potential (this measures how much the current output is wrong); 60 adversarial pairs constructed as in §13, covering every off-diagonal cell of the family matrix; 40 random pairs above the current exploratory floor; 20 pairs the current engines drop, sampled from investigators with thin embeddings, to test recall. Each label records a tier and, where the tier is Exploratory or Poor, a reason from the feedback taxonomy — “wrong type of research” with its axis sub-reason where applicable. Two hours of labeling per strategist; the set is versioned and grows with the feedback loop.

### Metrics

- **Tier precision.** Share of system-Strong pairs the strategists judged Strong or Moderate (target ≥ 85%); share of system-Moderate judged Moderate or better (≥ 70%). Reported per tier, per surface, per community.
- **Wrong-type rate.** Share of system-Strong and Moderate pairs labeled “wrong type of research” (target ≤ 5%). This is the metric the brief is really about.
- **Precision@5 per investigator** on the investigator page, and precision@10 per notice in Outreach.
- **Paradigm confusion matrix.** Investigator dominant family × notice required family, counted over recommendations. Off-diagonal mass in the forbidden cells (1↔5, 1↔6, 2↔5, 2↔6) should be zero.
- **Recall check.** Share of strategist-Strong pairs in the gold set that the system places in Strong or Moderate (≥ 75%); the remainder must appear in Exploratory, not Poor.
- **Explanation quality.** Strategist rating of the rationale (accurate / partially / wrong) on a 50-pair subsample, since the rationale is what the office shows to PIs.

### Regression suite

The nine §13 pairs, plus one pair per forbidden matrix cell, become Vitest fixtures over the pure scoring functions — profiles in, tier out — in the pattern `suggest.test.ts` already uses. Any change to the matrices, floors or extractor prompts must keep them green. The current engine’s behavior on the same fixtures is recorded once, as the baseline the redesign is measured against.

### Rollout comparison

Run both engines side by side for one monitored community for a month: strategists see the new output; the old output is logged. Compare tier precision and wrong-type rate on the pairs strategists actually acted on. Promote when the new engine wins on both and its Strong list is not more than 30% shorter — if it is, the floors are too tight and §12’s recalibration step runs first.

*§15 · Implementation plan*

## Migration plan

Capture first, classify second, score third. The existing embedding infrastructure, cron jobs, evidence tables and Outreach snapshot model all survive; the quick-match engine and the three-engine inconsistency do not.

The PR-by-PR work order with acceptance criteria and kickoff prompts, the open-decision log, the five LLM prompt specifications, the machine-readable taxonomy and rule mappings, and the adversarial fixtures live in the repository under `docs/fit-engine/` and `src/lib/fit/`. This section is the summary; that package is the build.

<table class="compact">
<colgroup>
<col style="width: 25%" />
<col style="width: 25%" />
<col style="width: 25%" />
<col style="width: 25%" />
</colgroup>
<thead>
<tr class="header">
<th>Phase</th>
<th>Scope</th>
<th>Concrete changes</th>
<th>Exit criterion</th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>0 · Capture</strong><br />
≈ 2 weeks</td>
<td>Stop discarding modality signals</td>
<td>PubMed: parse MeSH headings + tree numbers, check tags, publication types, abstract and author position from the efetch XML already requested; new columns on <code>investigator_publications</code>. CT.gov: parse <code>studyType</code>, <code>phases</code>, <code>designInfo</code>, enrollment, intervention types and investigator role from <code>raw_json</code>; backfill. RePORTER: extract activity code, RCDC categories, study section, contact/MPI flag from <code>raw_json</code>. NIH Guide: extend <code>parseNihGuide</code> to return sectioned full text; store on the notice. RePORTER by FOA: new fetch of funded exemplars per notice number and lineage.</td>
<td>Every verified publication has MeSH; every trial has design and role; every NIH notice has sectioned text; ≥ 80% of reissued PAs have ≥ 5 exemplars.</td>
</tr>
<tr class="even">
<td><strong>1 · Classify</strong><br />
≈ 3 weeks</td>
<td>Item profiles and structured profiles</td>
<td>Taxonomy tables (<code>fit_taxonomy</code>, versioned). Rule classifier (Appendix B) and LLM item classifier with cached JSON per content hash. Aggregation job producing <code>investigator_fit_profiles</code> (career and recent views, confidence, provenance) and <code>opportunity_fit_profiles</code> (text extraction + exemplar blend). Onboarding “how I do research” step and Edit-profile fields for self-declared axes and do-not-suggest categories. Nightly refresh alongside <code>embed-opportunities</code>.</td>
<td>Profiles exist for the whole directory and all open notices; spot-check of 30 investigators by strategists agrees with dominant paradigm ≥ 90%.</td>
</tr>
<tr class="odd">
<td><strong>2 · Score</strong><br />
≈ 3 weeks</td>
<td>One engine, three surfaces</td>
<td>Pure functions for stages 1–7 and 9 in <code>lib/fit/</code>, with the §13 fixtures as tests. <code>rankOpportunitiesForInvestigator</code>, <code>runSuggestions</code> and <code>refreshCommunityFits</code> call the same engine; the investigator page gains eligibility and gates it never had. <code>loadPiInvestigatorMatches</code> (quick-match) retired; opportunity detail “Best fit” reads from the engine. Gold set labeled; baseline recorded. Feature flag per team.</td>
<td>Tier precision and wrong-type rate beat the baseline on the gold set; the three surfaces agree on the same pair.</td>
</tr>
<tr class="even">
<td><strong>3 · Judge and explain</strong><br />
≈ 2 weeks</td>
<td>Stage 8 and the UI</td>
<td>LLM adjudication over the top 15 as specified in §16 — blind holistic pass, skeptic pass, informed reconciliation with corrections written back to profiles — with a strong model, cached by profile and notice versions. Rationale rendering from provenance; “Why not?” on hidden pairs; Exploratory as its own section with the gap line first; component bars in the evidence view. New dismissal reasons (“wrong type of research” with axis sub-reasons; “not eligible”) and the one-click profile-correction flow.</td>
<td>Explanation accuracy ≥ 85% on the 50-pair subsample; feedback capture live.</td>
</tr>
<tr class="odd">
<td><strong>4 · Learn</strong><br />
ongoing</td>
<td>Calibration, then ranking</td>
<td>Quarterly recalibration of floors and matrices against labels. Learning-to-rank over component scores once ≥ 300–500 labeled pairs exist. Embedding-model revisit (SPECTER2 or larger general model) only after the structured layer is stable, measured on the same gold set.</td>
<td>Tier precision stable or rising quarter over quarter; wrong-type rate ≤ 5%.</td>
</tr>
</tbody>
</table>

### Cost and load

Item classification is a one-time pass — on the order of 60 publications and 40 grants per investigator, most of which the rule classifier handles without a model call — then incremental by content hash, exactly as embeddings are today. Notice extraction is heavier per item (a full FOA is 20,000–60,000 characters) but runs once per notice version, nightly, over only new or changed notices. Stage 8 adjudication is the only per-request model cost and is bounded at 15 candidates per investigator or notice, cached. The investigator page stops doing per-candidate RPCs in a loop: profiles are precomputed, and the gates are a single query over structured columns.

### What is kept, what is retired

kept  
`evidence_embeddings` and `opportunity_embeddings` (used per item in stage 5); the nightly cron structure; `outreach_suggestions` snapshot model and its dismissed/added semantics; the facet-editing UI for opportunity profiles (extended to the new axes); the receipt-cycle and eligibility parsing.

retired  
`lib/quick-match` and its weights; `investigator_embeddings` as a ranking object (career vector — kept only for candidate generation if useful); `SIM` thresholds as tier definitions; the `GENERIC_WORDS` stop list (replaced by IDF and axis routing); the `epidemiology → population_health` and `implementation science → health_services_research` collapses in `vocab-config.ts`.

changed  
The investigator page copy: “Fit tier · evidence similarity · computed when you open this page” becomes “Fit · paradigm, design and topic · refreshed nightly”, which is also what the design handoff promised.

*§16 · Where AI belongs — and where it must not*

## The role of AI

AI is not a separate layer and it is not the scorer. It belongs at three points: telling the structure what things *are*, judging whether the arithmetic makes sense for *this* pair, and saying why. Its unique contribution is reasoning about specifics the schema cannot name. Its unique risk is doing semantic similarity in prose.

The structured methodology in §4–§10 is a **measurement** system. It is precise, consistent across thousands of pairs, cheap, and auditable down to the evidence item — and it can only measure what it was designed to measure. A large language model is a **reasoning** system. It can hold one investigator’s particular body of work and one notice’s particular intent in view at the same time and ask whether *this* prior work positions *this* person for *this* opportunity, including through chains of inference no taxonomy encodes. It is also expensive, variable between runs, unable to see the corpus (it does not know that “cancer” appears in a third of NCI notices), and — this is the point that decides the architecture — *itself a similarity machine at heart*. A model asked “is this a good fit?” with two blocks of text will, by default, reward the pair that reads alike. That is exactly the failure the redesign exists to remove. So the question is not whether to use AI but how to arrange things so that the model’s judgment adds what the structure lacks without re-importing what the structure was built to exclude.

### Division of labor

The rule of thumb: **anything that must be consistent, comparable across pairs, or cheap enough to run over the whole corpus is structured; anything that requires reading a specific document and reasoning about what it means is AI.** Several tasks are both, in a specific order — AI produces a classification that rules then verify, or rules produce a score that AI then interrogates.

| Task                                                                         | Structured                                                                                                  | AI                                                                                                                                                          | Why this split                                                                                                                                                                                  |
|------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Classify an evidence item** into the axes                                  | Rules from MeSH, publication types, CT.gov enums, activity codes, RCDC — override the model where they fire | Reads abstracts, biosketch contributions, RePORTER narratives; fills the schema with a one-line justification per non-zero value                            | Most of the “AI” value in this system is realized here, quietly: the taxonomy is only as good as the labeler that fills it. Structure where it exists, judgment where only prose exists.        |
| **Read a funding announcement**                                              | Title designation, activity code, IC, division, dates, exemplar distribution from RePORTER                  | Reads the full FOA and says what the program wants, what is non-responsive, what “translational” means *in this notice*, what is encouraged versus required | Intent extraction is judgment, not parsing. The deterministic fields anchor it; exemplars check it.                                                                                             |
| **Eligibility**                                                              | Rules over structured characteristics                                                                       | Extracts novel or unusual rules from Section III into the rule set; never decides eligibility directly                                                      | A person is eligible or not; there is nothing to reason about once the rule is known.                                                                                                           |
| **Paradigm, unit, design gates**                                             | Structured profile comparison, matrices, floors                                                             | —                                                                                                                                                           | Gates must behave identically for every pair or the system cannot be trusted or debugged.                                                                                                       |
| **Topic, methods, track record, actionability scores**                       | Coded overlap, IDF, item-level embeddings, BM25, facts                                                      | —                                                                                                                                                           | These need the corpus (IDF), arithmetic consistency, and speed.                                                                                                                                 |
| **Candidate generation**                                                     | Retrieval over structured columns and embeddings                                                            | One targeted sweep over the *near-miss* set (paradigm-compatible, topic-low) to find latent fit for Exploratory                                             | Running a model over 4,800 notices × the directory is unaffordable and is where similarity bias is worst. A constructed near-miss set is small and pre-filtered for the kind of fit rules miss. |
| **Holistic judgment of a short-listed pair**                                 | Provides the provisional tier and components                                                                | Two passes: a *blind* assessment from evidence and notice text alone, then an *informed* reconciliation                                                     | The blind pass supplies an independent signal; the informed pass supplies the audit trail. Neither alone does both.                                                                             |
| **Skeptical review**                                                         | Negative signals in §9                                                                                      | A separate adversarial pass on every provisional Strong: “argue this would be triaged as non-responsive”                                                    | Rules catch the mismatches someone anticipated; the skeptic catches the ones nobody wrote down.                                                                                                 |
| **Final score and tier**                                                     | Composite and floors, recomputed after any correction                                                       | Never emits a number; emits categorical verdicts and grounded corrections                                                                                   | Model-emitted scores look like probabilities and are not. Tiers stay arithmetic so two strategists see the same thing.                                                                          |
| **Explanation**                                                              | Component provenance: which items, which floors                                                             | Renders provenance into the sentence a strategist would say; every claim cites an evidence ID that exists                                                   | The explanation is the product. It must be readable and it must be true.                                                                                                                        |
| **Open-ended questions** (“who could lead this RFA if we assembled a team?”) | Supplies profiles and evidence                                                                              | The conversational assistant Prospera already has (`funding-chat`), pointed at the same profiles                                                            | This is the one place AI is genuinely a separate layer: on demand, with a human asking and judging, not in the nightly batch.                                                                   |

### What the model can see that the structure cannot

Latent fit is real, and it has a small number of recurring shapes. Naming them matters, because each one tells you what evidence the model must be *given* to find it — a model reasoning over a two-line summary finds none of them.

| Shape of latent fit                           | Example                                                                                                                                                                      | Why the structure misses it                                                                                                                                                   | What the model needs in front of it                                                                            |
|-----------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| **Methodological transfer**                   | Built Bayesian adaptive platform-trial designs in oncology → notice on adaptive platform trials in sepsis                                                                    | Topic overlap is zero; design axis says `rct` on both sides but the specific — adaptive design — is below the taxonomy’s resolution                                           | Trial protocols and methods sections of abstracts; the notice’s Section I methods language                     |
| **Asset ownership**                           | Runs a 5,000-person aging cohort with banked specimens → any notice needing longitudinal specimens from a diverse older population                                           | Materials axis records “cohort_datasets 0.9”; it cannot say *which* cohort, its size, or its population                                                                       | RePORTER abstracts of the infrastructure awards (U01, P30, R24); the notice’s data and population requirements |
| **Deliberate trajectory**                     | Mouse immunologist whose last three papers use human tumor samples with a clinical collaborator, and whose biosketch says so                                                 | The recent view captures a shift in weights; it cannot tell a pivot from noise                                                                                                | Recent items in date order; the biosketch personal statement; K-award start date                               |
| **Mechanistic adjacency**                     | TGF-β signaling in lung fibrosis → notice on kidney fibrosis mechanisms                                                                                                      | Disease codes differ (C08 vs C12); pathway code matches (D12 TGF-β) but the structure cannot judge whether the pathway is central to the notice or incidental                 | The notice’s Research Objectives paragraph; the investigator’s pathway-level papers                            |
| **Encouraged-but-not-required team shape**    | Notice “strongly encourages” pairing a basic scientist with a clinician; investigator’s top co-author is the relevant clinician                                              | Team axis records “multi-PI allowed”; co-author network is a separate table                                                                                                   | Section I team language; the collaborator list with each collaborator’s dominant paradigm                      |
| **Scale or role nuance in a matching design** | “EHR analysis” of a single site vs. a notice requiring distributed multi-site network analysis; “trial experience” as site sub-investigator vs. investigator-initiated PI    | Same design tag, different capability; the structure scores `ehr_analysis 0.8` either way                                                                                     | Abstracts (site counts, network names); CT.gov roles and sponsor types                                         |
| **Constraint hidden in prose**                | “Applications proposing new cohorts are non-responsive; must use existing NIH-funded cohorts” vs. an investigator whose cohort experience is one small self-recruited cohort | The design axis says `prospective_cohort 0.85` and stops                                                                                                                      | The non-responsive paragraph verbatim; the cohort awards                                                       |
| **Program history**                           | A PAR whose funded portfolio is entirely mouse mechanism despite “translational” in the title                                                                                | Handled by the exemplar prior (§6) — this one the structure *does* catch, which is the pattern to aim for: convert latent signals into structured ones as they are discovered | —                                                                                                              |

Can the model distinguish superficial similarity from genuine fit?

Yes — *conditionally*. When it is given the actual evidence items rather than summaries, the notice’s Section I and non-responsive text rather than its synopsis, and an output schema that forces it to judge paradigm, unit and design *before* it is allowed to speak about topic, a strong model reasons about fit rather than resemblance. Deny it any of those three and it reverts to resemblance, fluently. The structured layer is therefore not only the model’s counterweight; it is the model’s *input preparation*. Most of what makes the AI stage good happens before the model is called.

### Blind, then informed

The brief asks whether the model should receive the structured dimensions or evaluate independently. The answer is both, in sequence, with an information barrier between them. A model shown “provisional tier: Strong, S = 71” will mostly agree with it; that anchoring destroys the independent signal an ensemble needs. So the first pass is blind.

*Figure: Two blind passes read the same evidence a strategist would, and never see the structured score. The informed pass reconciles. A raise is never a direct override: the model must name the input it believes is wrong — an unparsed trial role, a misread notice requirement — and the structured score is recomputed with the correction. Only agreement yields a high-confidence Strong.*

**Blind holistic pass.** Inputs: the top evidence items with their text (not their axis labels), the notice’s Section I, non-responsive paragraph and investigator-eligibility text, and the collaborator list. Output schema, in this order: a judgment on paradigm fit with cited item IDs; on unit of analysis; on required designs; on topic; then a categorical verdict (Strong / Moderate / Exploratory / Poor) and the single most important gap. The order is the guardrail: the model cannot say Strong before it has written “design required: clinical trial; evidence of leading one: none.”

**Skeptic pass.** Same inputs, different role: a program officer reading this as a likely non-responsive application. Output: the strongest objection, its evidence, and whether it is gate-level (paradigm, design, eligibility) or a matter of emphasis. Run on every provisional Strong and on every blind-pass Strong.

**Informed reconciliation.** Sees everything — components, provisional tier, both blind outputs. Its job is not to decide the tier; it is to explain any disagreement and, where it believes the structure is wrong, to propose a *specific, checkable correction* to an input: “`investigator.design.rct` should be ≈ 0.7 — NCT0…, NCT0… list this person as PRINCIPAL_INVESTIGATOR; the ingest recorded no role,” or “`notice.paradigm.required` should include `human_biospecimen` — Section I, paragraph 3 defines the translational scope as mechanistic work in human tissue.” Corrections carry provenance, are applied, and the structured score is recomputed. If the floors are now met, the tier rises. If the model’s insight cannot be expressed as a correction to any input, the pair goes to Exploratory with the insight as its rationale, and a taxonomy-gap entry is logged.

### Reconciliation rules

Structured tier

Blind verdict

Skeptic

Outcome

Confidence shown

Strong

Strong

No gate-level objection

Strong

High

Strong

Moderate

Emphasis-level objection

Strong, or Moderate if the objection is grounded in a cited item

Medium; rationale names the objection

Strong

Exploratory / Poor

Gate-level objection with cited evidence

Lower to the blind verdict; log a structured-miss for taxonomy or ingest repair

—

Strong

Exploratory / Poor

Objection not grounded in any provided item

Strong stands; confidence drops; pair queued for strategist review

Low — “AI dissent, unsupported”

Moderate / Exploratory

Strong, with a correction the reconciler can state

—

Apply correction, re-score; tier follows the floors. Never more than one tier per cycle without strategist confirmation

Medium until a human confirms the correction

Moderate / Exploratory

Strong, with no expressible correction

—

Exploratory with the model’s rationale; “AI-flagged lead” in the strategist queue

Review

Poor (gated)

Strong / Moderate

—

Gate stands unless the model identifies a *specific* gate input as wrong (misparsed role, misread requirement) — then correct and re-score. A topical argument never reopens a gate

Review

any

any

—

Blind pass run twice (paraphrased prompt or second model) disagrees with itself by ≥ 2 tiers → treat the blind verdict as absent

Structured only

Asymmetry is the design: either system can lower a tier with grounded evidence; both must agree for Strong; the model can raise only by correcting an input the structure then re-scores, and a gate-level Poor reopens only for a gate-level correction.

### What an override must be able to show

The brief asks whether the model should be allowed to override a low structured score for a non-obvious but compelling fit. Directly, no. Indirectly — by naming what the structure got wrong — yes, and that is a better mechanism, because every accepted correction improves the profile for every future notice rather than fixing one pair. The evidence bar for a correction, in ascending order of what it can unlock:

- **To raise a methods or topic component:** at least one cited evidence item whose text supports the claim (an abstract naming the method; a paper on the pathway). Unlocks Exploratory → Moderate.
- **To raise a design component:** a structured record the ingest missed or misread — a CT.gov registration with a PI role, a publication with a trial publication type, a RePORTER award whose abstract describes the design. Unlocks up to Strong if floors are then met.
- **To change a notice’s required paradigm or design:** a verbatim quote from Section I or the non-responsive paragraph, checked against the exemplar distribution when one exists. Applies globally, so it is queued for strategist confirmation before taking effect for anyone but the pair that raised it.
- **To reopen a paradigm gate:** only a correction to the investigator’s paradigm weights supported by ≥ 2 verified items in the required family, or a correction to the notice’s required family with a verbatim quote. A topical argument — however compelling — cannot reopen a paradigm gate; that is the whole point of the gate.

Everything that clears these bars is written back as a profile or notice-profile edit with the model as author, so it is visible, reversible and auditable in the same place strategists already edit facets.

### Guardrails against similarity in prose

1.  **Decomposed output before verdict.** Paradigm, unit, design and topic judgments are separate fields, each with evidence IDs, and the verdict field comes last. A Strong verdict that contradicts the model’s own design field is rejected by a rule, not by another model.
2.  **Evidence-ID grounding.** Every claim cites an item ID from the provided set. Claims citing IDs that do not exist are dropped; a verdict left with no grounded claims is treated as absent. This is what prevents an invented paper from creating a fit.
3.  **Topic-masked sub-pass.** For paradigm and design judgments, disease and topic terms in both the evidence and the notice are replaced with placeholders (`[DISEASE]`, `[PATHWAY]`) before the model sees them. “Ignoring what this is about, does this person do the kind of research required?” is the LLM analog of computing topic only over compatible items, and it removes the single largest source of prose-level over-matching.
4.  **Mandatory counter-case.** The skeptic pass exists so that agreement is earned. A Strong that survives a genuine attempt to triage it is worth more than a Strong nobody argued against.
5.  **No numbers from the model.** Categorical verdicts and grounded corrections only. Scores come from the arithmetic; the model changes scores only by changing inputs.
6.  **Self-consistency.** The blind pass runs twice (paraphrased prompt, or two models). Disagreement by two tiers voids the blind signal for that pair rather than averaging it.
7.  **Measured authority.** The blind pass is scored on the §14 gold set exactly as the structured engine is. Its tier precision and wrong-type rate are published on the dashboard. If its wrong-type rate is high, the reconciliation table above is tightened until it is not; its authority is earned from data, not assumed.
8.  **Sampled audit.** A monthly random sample of accepted corrections, lowered Strongs and AI-flagged leads goes to a strategist. The model’s hit rate on each is tracked over time.

### The proposed six-stage shape, refined

The brief’s outline — structured filtering, quantitative matching, AI review of the full profile and notice, AI identification of non-obvious relationships and mismatches, reconciliation, calibrated recommendation — is the right shape. Five refinements from the reasoning above:

1.  **AI also belongs upstream.** Item classification and notice intent extraction are where most of its value is realized, and they are not a separate layer; they are what fills the structure. Treating “AI” as only the review stage undersells it and overloads that stage.
2.  **The review stage is blind to the score.** Otherwise it is not an independent assessment, and an ensemble of two correlated judges is one judge.
3.  **“Non-obvious relationships” and “non-obvious mismatches” are two different jobs.** A scout, run over the near-miss set, looks for latent fit and feeds Exploratory. A skeptic, run over provisional Strongs, looks for reasons to triage and protects precision. They need opposite dispositions and should be separate prompts, not one “consider both” instruction.
4.  **Reconciliation corrects inputs, then re-scores.** Not “the model’s verdict counts for 30%.” A blended score is unexplainable and lets similarity back in through the blend; a corrected input is auditable and compounds.
5.  **There is a human in the loop for the genuinely novel.** AI-flagged leads that no correction can express go to strategists, not to PIs. A research-development office is precisely the place where a person can say “yes, actually, she would be perfect for this” — the system’s job is to make that judgment cheap to exercise, not to replace it.

The central question, answered

What should AI contribute beyond a well-designed matching algorithm? Three things the algorithm cannot do: **read** — turn abstracts, biosketches and forty-page solicitations into the structured facts the algorithm runs on, with judgment about what the text means; **notice** — see the specific transfer, asset, trajectory or hidden constraint that sits between the taxonomy’s categories, and say exactly which input the algorithm should have had; and **argue** — make the case against a match that scores well, and the case for one that does not, in terms a strategist can check. What it should not contribute is a second, less transparent score. Judgment at the edges, arithmetic in the middle, and every disagreement resolved by evidence rather than by weight.

Appendix A

## Data-capture changes

| Where                                                      | Today                                                                             | Change                                                                                                                                                                                                                                                                                                                             |
|------------------------------------------------------------|-----------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| lib/community/pubmed-ingest.ts                             | efetch XML requested; only title, journal, date, author match kept                | Parse `MeshHeadingList` (DescriptorName UI + MajorTopicYN, qualifiers), `PublicationTypeList`, `Abstract`, `AuthorList` position of the matched author. Resolve descriptor UIs to tree numbers with a cached MeSH descriptor table (annual XML from NLM).                                                                          |
| investigator_publications                                  | pmid, title, journal, date, identity                                              | Add `mesh JSONB`, `publication_types TEXT[]`, `abstract TEXT`, `author_position TEXT`, `item_profile JSONB`, `item_profile_version`.                                                                                                                                                                                               |
| lib/community/clinicaltrials-ingest.ts                     | Parses title, status, conditions, sponsor, dates, summary; stores full `raw_json` | Parse `designModule.studyType`, `phases`, `designInfo` (allocation, interventionModel, primaryPurpose, observationalModel, timePerspective), `enrollmentInfo.count`, `armsInterventionsModule.interventions[].type`, the matched investigator’s `overallOfficials[].role` and `responsibleParty`. Backfill from stored `raw_json`. |
| investigator_nih_grants                                    | project_num, title, IC, FY, active, `raw_json`                                    | Materialize `activity_code`, `rcdc_categories TEXT[]`, `study_section`, `is_contact_pi`, `abstract`, `phr_text`, `item_profile JSONB` from `raw_json`. Confirm the RePORTER request’s `include_fields` covers `full_study_section`, `spending_categories_desc`, `abstract_text`, `phr_text`, `principal_investigators`.            |
| lib/ingestion/nih-guide/parse.ts                           | Key Dates and header facts                                                        | Add `parseGuideSections()`: Part 1 Purpose; Section I (Background, Research Objectives / Specific Areas of Research Interest, Non-Responsive); Section II; Section III.3; Section IV clinical-trial and human-subjects items; Section VII contacts with division. Store as `funding_opportunities.guide_sections JSONB`.           |
| funding_opportunities                                      | clinical_trial_note (free text)                                                   | Add `clinical_trial_designation ENUM` (required / optional / not_allowed / besh_required / unknown), `program_division TEXT`, `reissue_of TEXT[]`, `fit_profile JSONB`, `fit_profile_confidence`.                                                                                                                                  |
| new · opportunity_exemplars                                | —                                                                                 | RePORTER projects by FOA number and lineage: project_num, abstract, activity code, RCDC, item_profile. Refreshed monthly.                                                                                                                                                                                                          |
| new · investigator_fit_profiles · opportunity_fit_profiles | —                                                                                 | The §5 and §6 records, versioned by taxonomy, with provenance arrays.                                                                                                                                                                                                                                                              |
| new · fit_labels                                           | `match_feedback` exists from the legacy engine                                    | Gold-set and strategist-override labels: pair, tier, reason, axis sub-reason, labeler, engine version. Reuse or replace `match_feedback`.                                                                                                                                                                                          |
| outreach_suggestions.dismissed_reason                      | 5 reasons                                                                         | Add `wrong_research_type` (+ `axis_reason` column) and `not_eligible`.                                                                                                                                                                                                                                                             |
| investigators                                              | self-declared focus text                                                          | Add `self_declared_axes JSONB`, `aspirations TEXT[]`, `do_not_suggest TEXT[]`, `title_series`, `degrees TEXT[]`.                                                                                                                                                                                                                   |

Appendix B

## Signal-to-axis mapping

The rule classifier’s starting table. Values are probabilities assigned to the axis category when the signal is present on an item; multiple signals combine by noisy-OR. Strings shown for readability — the implementation keys on MeSH descriptor UIs and tree numbers, CT.gov enums and RePORTER codes.

| Signal                                                                                                                                                   | Source                | Axis A paradigm                                                     | Axis B unit                             | Axis C design                                          | Axis D materials                         |
|----------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------|---------------------------------------------------------------------|-----------------------------------------|--------------------------------------------------------|------------------------------------------|
| PT: Randomized Controlled Trial                                                                                                                          | PubMed                | clinical_trials .95                                                 | L3 .9                                   | rct .95                                                | enrolled_participants .9                 |
| PT: Clinical Trial, Phase I / II / III / IV                                                                                                              | PubMed                | clinical_trials .9 · early_phase_human_experimental .7 (phase I)    | L3 .9                                   | early_phase_trial (I) / rct (II–IV) .9                 | enrolled_participants .9                 |
| PT: Pragmatic Clinical Trial                                                                                                                             | PubMed                | clinical_trials .8 · health_services .5 · implementation_science .4 | L3 .6 · L5 .5                           | pragmatic_trial .95                                    | patients_under_care .8                   |
| PT: Observational Study + MeSH Prospective Studies + Humans                                                                                              | PubMed                | clinical_observational .7 · epidemiology .5                         | L3 .6 · L4 .5                           | prospective_cohort .9                                  | enrolled_participants .7                 |
| MeSH Cohort Studies + Risk Factors + Incidence/Prevalence                                                                                                | PubMed                | epidemiology .85                                                    | L4 .85                                  | prospective/retrospective_cohort .8                    | cohort_datasets .8                       |
| MeSH Case-Control Studies · Cross-Sectional Studies                                                                                                      | PubMed                | epidemiology .8 · clinical_observational .4                         | L4 .8                                   | case_control / cross_sectional .95                     | —                                        |
| MeSH Genome-Wide Association Study · Polymorphism SNP · Mendelian Randomization Analysis                                                                 | PubMed                | genetic_epidemiology .9                                             | L4 .8 · L1 .4                           | gwas .95 · causal_inference (MR) .8                    | genomic_datasets .9 · biobank .6         |
| MeSH Electronic Health Records · Insurance Claim Review · Medicare · Databases Factual                                                                   | PubMed                | health_services .7 · epidemiology .5 · outcomes_research .5         | L4 .8 · L5 .5                           | ehr_analysis / claims_analysis .9                      | ehr / claims .95                         |
| MeSH Health Services Research · Health Services Accessibility · Delivery of Health Care · Quality of Health Care                                         | PubMed                | health_services .9 · outcomes_research .6                           | L5 .8                                   | —                                                      | —                                        |
| MeSH Comparative Effectiveness Research                                                                                                                  | PubMed                | comparative_effectiveness .95                                       | L3 .5 · L4 .6                           | —                                                      | —                                        |
| MeSH Implementation Science · Diffusion of Innovation                                                                                                    | PubMed                | implementation_science .95                                          | L5 .8                                   | implementation_evaluation .8 · hybrid .5               | —                                        |
| MeSH Community-Based Participatory Research                                                                                                              | PubMed                | community_based .95                                                 | L4 .9                                   | community_engaged .95                                  | —                                        |
| MeSH Social Determinants of Health · Health Status Disparities · Socioeconomic Factors                                                                   | PubMed                | population_health .85                                               | L4 .85                                  | —                                                      | —                                        |
| MeSH Qualitative Research · Interviews as Topic · Focus Groups · Surveys and Questionnaires                                                              | PubMed                | behavioral .4 · health_services .3                                  | L3 .5 · L4 .5                           | qualitative / survey .9                                | —                                        |
| MeSH Machine Learning · Computational Biology · Models Statistical                                                                                       | PubMed                | computational_data_science .8                                       | —                                       | ml_model_development .7 · statistical_epi_modeling .5  | —                                        |
| Check tag Animals / Mice / Rats / Zebrafish, without Humans                                                                                              | PubMed                | animal_model .8 · mechanistic .5                                    | L2 .8 · L1 .5                           | animal_in_vivo .8                                      | mouse / rat / zebrafish .9               |
| MeSH Disease Models, Animal · Mice, Knockout · Mice, Transgenic · Xenograft Model Antitumor Assays                                                       | PubMed                | preclinical .8 · animal_model .8                                    | L2 .9                                   | animal_in_vivo .9 · perturbation .6 · xenograft_pdx .9 | mouse .9                                 |
| MeSH Cell Line · Cells, Cultured · Organoids, without Humans check tag on subjects                                                                       | PubMed                | mechanistic .8 · basic_discovery .5                                 | L1 .9                                   | wet_lab .9                                             | cell_lines / organoids .9                |
| MeSH Signal Transduction · Gene Expression Regulation · CRISPR-Cas Systems · Gene Knockdown Techniques                                                   | PubMed                | mechanistic .85                                                     | L1 .9                                   | perturbation .85                                       | —                                        |
| MeSH Single-Cell Analysis · Sequence Analysis, RNA · Proteomics · Metabolomics                                                                           | PubMed                | — (method, not paradigm)                                            | L1 .7                                   | single_cell / bulk_omics / proteomics .9               | —                                        |
| Humans + Biopsy / Biomarkers / Specimen Handling / primary human cells, no trial or cohort PT                                                            | PubMed                | human_biospecimen .8 · translational .5                             | L1 .6 · L3 .7                           | biospecimen_assay .85                                  | human_tissue / human_blood .9            |
| Triangle-of-biomedicine compound class (Animal + Human, Cell + Human)                                                                                    | PubMed (tree numbers) | translational .7                                                    | —                                       | —                                                      | —                                        |
| studyType INTERVENTIONAL + role PRINCIPAL_INVESTIGATOR                                                                                                   | CT.gov                | clinical_trials .95                                                 | L3 .95                                  | rct / early_phase_trial by phase .9                    | enrolled_participants .95                |
| primaryPurpose HEALTH_SERVICES_RESEARCH                                                                                                                  | CT.gov                | health_services .8 · implementation_science .4                      | L5 .6                                   | pragmatic_trial .6                                     | —                                        |
| primaryPurpose BASIC_SCIENCE (interventional)                                                                                                            | CT.gov                | early_phase_human_experimental .9                                   | L3 .9                                   | early_phase_trial .7                                   | enrolled_participants .9                 |
| studyType OBSERVATIONAL · observationalModel COHORT · enrollment ≥ 1,000                                                                                 | CT.gov                | epidemiology .6 · clinical_observational .5                         | L4 .8                                   | prospective_cohort .9                                  | cohort_datasets .7                       |
| Activity code K23 · K24                                                                                                                                  | RePORTER              | clinical_trials .6 · clinical_observational .7                      | L3 .8                                   | —                                                      | enrolled_participants .8                 |
| Activity code K08                                                                                                                                        | RePORTER              | mechanistic .6 · translational .6                                   | L1 .6                                   | wet_lab .7                                             | —                                        |
| Activity code UG3/UH3 · UM1 · U01 (clinical network) · R34                                                                                               | RePORTER              | clinical_trials .8                                                  | L3 .8                                   | rct .8                                                 | —                                        |
| Activity code R18                                                                                                                                        | RePORTER              | implementation_science .7 · health_services .6                      | L5 .7                                   | hybrid / implementation_evaluation .7                  | —                                        |
| RCDC “Clinical Trials” · “Clinical Research” · “Health Services” · “Comparative Effectiveness Research” · “Prevention” · “Behavioral and Social Science” | RePORTER              | matching category .7 each                                           | —                                       | —                                                      | —                                        |
| Study section IRG family (e.g., Epidemiology; Health Services Organization and Delivery; Cellular and Molecular Immunology)                              | RePORTER              | family prior .6 from a curated IRG → family table                   | —                                       | —                                                      | —                                        |
| Title “Clinical Trial Required”                                                                                                                          | Notice                | required: clinical_trials                                           | required: L3                            | required_any: rct, early_phase_trial, pragmatic_trial  | enrolled_participants required           |
| Title “Basic Experimental Studies with Humans Required”                                                                                                  | Notice                | required: early_phase_human_experimental or human_biospecimen       | required: L1 or L3 with human materials | required_any: wet_lab, perturbation, early_phase_trial | human materials or participants required |
| Title “Clinical Trial Not Allowed”                                                                                                                       | Notice                | excluded: clinical_trials                                           | —                                       | prohibited: rct, pragmatic_trial, early_phase_trial    | —                                        |
| Scientific contact division (e.g., NCI DCCPS; NHLBI Epidemiology Branch; NIDDK DEM)                                                                      | Notice §VII           | family prior .5 from a curated division → family table              | —                                       | —                                                      | —                                        |
| UCSF title series “Professor of Clinical …” · “HS Clinical”                                                                                              | Profiles              | clinical role prior; clinical_observational .3                      | —                                       | —                                                      | —                                        |
| Department Epidemiology & Biostatistics                                                                                                                  | Directory             | epidemiology .5 · population_health .4 (prior only)                 | L4 .4                                   | —                                                      | —                                        |

Starting values, to be revised against the gold set. The RCDC research-type category names should be confirmed against the current NIH RCDC list before implementation; “Epidemiology and Longitudinal Studies” and “Dissemination and Implementation Research” likely exist as well and would map directly.

**Grounding.** Code references are to the Prospera repository as of 4 September 2026: `src/lib/outreach/{suggest,rank-opportunities,embeddings,profile}.ts`, `src/lib/quick-match/*`, `src/lib/community/{pubmed,clinicaltrials,reporter}-ingest.ts`, `src/lib/ingestion/nih-guide/*`, `src/lib/normalization/vocab-config.ts`, and the `supabase/migrations` schema. The Animal / Cell / Human classification of publications by MeSH tree number follows Weber, “Identifying translational science within the triangle of biomedicine,” *J Transl Med* 2013 (PMC3666890). ClinicalTrials.gov field names follow the API v2 data model; NIH activity-code semantics follow the NIH Grants & Funding activity-code definitions; RCDC categories follow NIH RePORT.
