# Handoff: Fit UX redesign (Prospera)

## Overview

A redesign of the surfaces where Prospera shows PI ↔ NOFO fit: the investigator page's "Opportunities that
fit", the opportunity page's "Suggested recipients", the Outreach workspace's recipients tab, and the evidence
view behind them. The problem was not the model — it was that the interface explained the model instead of the
decision, and blurred three things a strategist must keep apart: whether the science is the same *kind* of
research, whether the person is *eligible*, and how much *evidence* the assessment rests on.

The redesign keeps the engine's tier vocabulary (Strong match / Moderate match / Exploratory) and adds three
separately-worded verdicts beside it, one sentence of reason, one sentence of caveat, and one next action per
row. Scores, component bars and floors move behind an audit layer.

Full audit, the eleven design decisions, and four model-level limitations found along the way are in
`AUDIT_AND_DECISIONS.md` in this folder. **Read that first** — this README covers implementation detail; that
file covers why.

## About the design files

The `.dc.html` files in this bundle are **design references created in HTML**. They are prototypes showing
intended look and behaviour — not production code to copy. The task is to recreate them inside Prospera's
existing environment: **Next.js 14 App Router, TypeScript strict, Tailwind, Supabase, server components by
default**, using the existing token set (`tailwind.config.ts`, `globals.css`) and UI primitives
(`src/components/ui/{pill,button,menu,dialog}.tsx`).

Every colour, size and spacing value in the prototypes is a literal inline style **because the prototype format
requires it**. In the codebase these must be Tailwind classes from the existing scale — `text-dense`,
`text-ink-muted`, `border-line-row`, `rounded-card` — not arbitrary values. The mapping is in **Design tokens**
below.

Work on branch `design/fit-ux-review` in a clone outside the user's original folder. The original Prospera
folder must not be modified.

## Fidelity

**High fidelity.** Colours, typography, spacing and interaction states are final and are taken from the repo's
own token set. Recreate pixel-for-pixel using existing Tailwind classes. Two deliberate departures from today's
UI, both intentional and both explained in `AUDIT_AND_DECISIONS.md`:

1. The Outreach workspace is drawn at full page width rather than inside the 880px `SlideOver`. Reversible —
   the row grid fits either.
2. The PI's own view has no per-row action button. That is a deliberate gap, not an omission (§3h).

## Screens / views

The prototype `fit-redesign-a-inline.dc.html` carries four screens behind a dark review bar at the top. **That
bar is a review harness, not part of the product — do not implement it.** Each screen below maps to a real
route.

### 1. Investigator → funding · `/investigators/[id]`

Replaces the `FitOpportunities` block inside the "Opportunities that fit" `SectionCard`.

**Purpose.** A strategist (or the PI) scans open notices assessed against one investigator's fit profile and
decides which are worth pursuing.

**Layout.** Page shell unchanged: 240px sidebar, page column `px-page pt-8 pb-16`, `min-w-page` (1366).
Existing header (avatar, name, meta line, action buttons) unchanged. The fit card is a standard
`rounded-card border border-line bg-card` section, full width of the left column.

**Card header** — `flex items-center justify-between gap-4 border-b border-line px-5 py-3`:
- `h2` "Funding that fits", `text-[15px] font-semibold text-ink`, `mr-2`
- Filter chips, `gap-2`: `h-[26px] rounded-control px-2.5 text-meta font-medium border`. Active:
  `border-navy bg-navy text-white`. Idle: `border-line bg-card text-ink-body`. Labels are computed from the
  data — `All 5`, `Strong 1`, `Moderate 1`, `Exploratory 2`, `Can't assess 1` — and a chip is omitted when its
  count is zero. **Do not hardcode these strings**; an earlier draft did and immediately misstated a count.
- Right side: `text-meta text-ink-muted` "Sorted by deadline"; when 2–3 rows are selected, a
  `h-7 rounded-control border border-navy bg-navy px-2.5 text-dense font-medium text-white` "Compare *n*"
  button, and on people-facing lists an "Add *n* to recipients" secondary button.

**Row** — `border-t border-line-row`, grid `grid-cols-[18px_104px_minmax(0,1fr)_132px] items-start gap-3.5 px-5 py-3.5`:

| Column | Contents |
|---|---|
| 18px | Selection checkbox, `h-[18px] w-[18px] rounded-[4px] border border-line-control`; checked `border-teal bg-teal text-white` with a `✓` at `text-meta`. Hidden entirely in the PI view. |
| 104px | The tier label. `inline-flex rounded-control px-[9px] py-[3px] text-meta font-semibold`. Strong match: `bg-teal text-white`. Moderate match: `bg-teal-tint text-teal`. Exploratory: `border border-line-control bg-card text-ink-body`. Can't assess: `bg-warning-tint text-warning`. Ruled out: `bg-line-row text-ink-muted`. These reuse the existing `Pill` tier variants with a 6px radius instead of a full pill — add `tier-*-square` variants rather than improvising at the call site. |
| flex | Title `text-[15px] font-semibold leading-[1.4] text-ink`; meta `text-meta text-ink-muted mt-[3px]` (agency · number · mechanism · budget); reason `text-body leading-[1.5] text-ink mt-2`; caveat `text-body leading-[1.5] mt-1.5`, `text-ink-body` when there is no material caveat, `font-medium text-warning` when a requirement is unmet or evidence is thin, `font-medium text-danger` when a gate fails. Then the verdict chips row, `flex flex-wrap gap-1.5 mt-2.5`. |
| 132px | Right-aligned column, `flex flex-col items-end gap-2`: deadline `text-dense font-medium text-ink` (`font-semibold text-danger` when urgent, `text-ink-muted` when far off or closed), then the action button `h-8` — primary `border-navy bg-navy text-white`, secondary `border-line-control bg-card text-ink`, quiet `border-transparent bg-transparent text-ink-muted`. |

**Verdict chips.** `inline-flex rounded-[5px] px-2 py-0.5 text-meta font-medium`. Neutral `bg-line-row
text-ink-body`; caution `bg-warning-tint text-warning`; blocking `bg-danger-tint text-danger`. Three per row,
always in this order: approach, eligibility, evidence. Then a `text-meta font-medium text-teal` disclosure
button reading "Why, and what it rests on" / "Hide the reasoning".

**Disclosure** (inline, `border-t border-line-row bg-footer-bar px-5 pb-[18px] pt-4 pl-[156px]`, aligning with
the title column). Two columns, `grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-7`:
- Left: uppercase label "Why you are seeing this" (`text-label font-semibold uppercase tracking-[0.08em]
  text-ink-muted`), a `text-body leading-relaxed text-ink` paragraph, then "What would have to be true" /
  "Worth checking before you write" / "Why it is ruled out" and a `list-disc pl-[18px]` list.
- Right: "What this rests on" and 2–3 evidence cards — `rounded-tile border border-line bg-card px-3 py-2.5`,
  title `text-dense font-medium`, meta `text-meta text-ink-muted`, source link right-aligned `text-micro
  font-medium text-teal`. Below: "All evidence and components →" and "This is wrong…".

**Card footer** — `border-t border-line-row bg-footer-bar px-5 py-[11px]`: left, "Show 1 ruled out
(eligibility)" toggle (`text-dense font-medium text-ink-body`, hidden in the PI view); right, provenance
`text-meta text-ink-muted` — stated **once per card**, not per row.

### 2. Opportunity → PIs · `/opportunities/[id]`

Same row component, subject inverted. In the prototype this is shown as a full list; in the app it is the
340px "Suggested recipients" aside, which is too narrow for the four-column row. **Implement the aside as the
top 3 rows in a stacked variant** — label and title, reason, caveat, chips wrapped to two lines, action full
width — and link "See all *n* in Outreach →". The verdicts and copy do not change between variants.

The right-hand column is captioned **Status** ("Not contacted") on people-facing lists and **Deadline**
("Oct 5 · 28 days") on notice-facing lists. One field, two captions — do not let the notice caption leak onto
a person.

### 3. Outreach recipients · `/outreach?item=…`

**Header** (unchanged from `outreach-workspace.tsx`): uppercase `STAGE · OWNER` label line, `text-[18px]
font-semibold leading-[1.3] tracking-[-0.01em]` title, meta line ending in a teal "Full notice →". Tabs
`Recipients n / Message / Notes & activity n`, `border-b-2 border-navy` on the active tab. Footer actions
`Skip suggestions` · `Park` · `Compose outreach · n people · n communities`.

**Changed:** the editable opportunity-profile facet grid collapses to one line of prose in a `bg-footer-bar`
strip — "Assessed against 5 facets read from the notice — human participants required, clinical trials
excluded, …" — with `Edit what counts as a match` and `Reassess` beside it. The full facet editor is unchanged
behind Edit.

**Communities** move onto the same grammar as people: name + tier label, reason line, caveat line, verdict
chips, one action. Non-matching monitored communities collapse to one line.

**Selected** stays a compact list: avatar, name + origin pill, meta, status, Remove.

### 4. Deep view — "All evidence and components →"

Replaces the list in place (no new route); "← Back to the list" restores the list, its filter and the
selection. Sections top to bottom, mirroring the row's order:

1. Provenance strip, `bg-footer-bar`: back link + "Evidence snapshot saved …".
2. Header: tier label, `text-[20px] font-semibold tracking-[-0.015em]` title, meta, action + "This is wrong…".
3. Verdict recap: three equal columns divided by `border-l border-line-row`, each an uppercase label and the
   verdict sentence in its tone colour.
4. Why you are seeing this + what would have to be true (`max-w-[78ch]`).
5. **Approach, side by side** — two bordered panels, "What the notice funds" / "What the evidence shows",
   four aligned rows each (paradigm, unit, designs, topic terms). Divergent rows in `text-warning` or
   `text-danger`. This is the instrument that stops shared disease keywords reading as a match; it has no
   equivalent in today's UI.
6. **Two rule tables side by side**: "Eligibility · who may apply" (Met / Fails / Unknown) and "Notice
   requirements · what the application must contain" (Met by the evidence / Not met by the evidence /
   Unknown), each rule with its verified quote. Keeping these apart is load-bearing — human subjects is a
   requirement on the materials axis, not an eligibility rule.
7. The items, each with its source link; **"Not this person" only on publications**, since
   `reviewIdentityAction` takes `kind: "publication"`.
8. `<details>` "Engine internals · component scores, floors and caps", collapsed. Inside: the eight components
   with bar, value, and the real floor pair from `taxonomy.json` ("Strong 0.75 · Moderate 0.50"), then the S
   value, caps and stage-8 marker, and a link to the admin inspector. Framed as inputs to the verdicts above,
   not a second opinion on them.

### 5. Empty and degraded states

Four, all keeping the card's shape: no profile built · profile built but nothing clears the bar · notice
reissued after the assessment (amber banner + Reassess) · directory too thin to assess. Copy in the prototype;
the second is deliberately written as an answer ("Nothing open is worth your attention right now"), not a gap.

## Interactions & behaviour

- **Disclosure**: one row open at a time; toggling another closes the first. No animation.
- **Selection**: up to 3 rows; selecting a fourth drops the oldest. Selected row `bg-[#f7fbfb]`.
- **Compare**: 2–3 columns, ordered by position in the list (not click order), each removable from inside the
  comparison; removing until one remains returns to the list. Filter and selection survive.
- **Deep view**: replaces the list; back restores scroll position, filter and selection.
- **Filters**: single-select chips; counts recomputed from data.
- **PI view** (`fitAudienceFor` → `investigator`): Strong and Moderate only; no checkboxes, compare, bulk
  actions, ruled-out toggle or per-row action; provenance copy changes.
- **Hover**: rows do not change background on hover (the flat system uses borders, not elevation); buttons and
  links use the existing hover tokens. Focus is the standard 2px teal ring.
- **Loading**: reuse the existing skeleton rows in `recipients-tab.tsx`.

## State management

Server-rendered lists as today; the interactive shell is a client component holding:

```ts
{ open: string | null            // row whose disclosure is expanded
  deep: string | null            // row shown in the audit view
  selected: string[]             // ≤3, compare set
  comparing: boolean
  filter: "all" | "strong" | "moderate" | "exploratory" | "unknown"
  showRuledOut: boolean }
```

No new fetching. The verdicts derive from data the surfaces already load: `fit_results` list rows, the notice
profile, the investigator profile. `deep` may lazily fetch the verified quotes and full item list if you do not
want them in the list payload.

## Design tokens

All exist already — use the Tailwind names, not the hex values.

| Prototype value | Token |
|---|---|
| `#0b1d3a` | `navy` / `text-ink` |
| `#0e6b78` `#e3f4f6` | `teal` / `teal-tint` |
| `#475569` `#64748b` `#334155` | `ink-body` / `ink-muted` / `ink-on-tint` |
| `#e2e8f0` `#cbd5e1` `#f1f5f9` | `line` / `line-control` / `line-row` |
| `#f7f8fa` `#ffffff` `#fafbfc` | `canvas` / `card` / `footer-bar` |
| `#1e6b3a` `#e6f4ea` | `success` / `success-tint` |
| `#8a4b0c` `#fdf1dc` `#5c3106` `#f0d6a8` | `warning` / `-tint` / `-dark` / `-border` |
| `#b42318` `#fdecea` `#7a1a10` | `danger` / `-tint` / `-dark` |
| 15/14/13/12/11px | `text-[15px]` / `text-body` / `text-dense` / `text-meta` / `text-micro` |
| uppercase 11px 0.08em | `text-label font-semibold uppercase tracking-[0.08em]` |
| 6 / 8 / 10px radius | `rounded-control` / `rounded-tile` / `rounded-card` |
| 36 / 32 / 28px buttons | `Button size={36｜32｜28}` |

Floors quoted in the internals block come from `src/lib/fit/taxonomy.json` at render time — never typed into a
component.

## Assets

- `brand/prospera-app-icon.png`, `brand/prospera-wordmark.png` — copied from `public/brand/`, already in the app.
- `fonts/GeistVF.woff`, `fonts/GeistMonoVF.woff` — copied from `src/app/fonts/`, already wired through
  `--font-sans` / `--font-geist-mono`.
- Icons are Lucide outlines at 1.5 stroke, already in `src/components/layout/sidebar-nav-icons.tsx`. No new icons.

## Files

| File | Contents |
|---|---|
| `fit-redesign-a-inline.dc.html` | The redesign: four screens + strategist/PI toggle |
| `Fit — Current.dc.html` | Today's four surfaces, recreated from the repo, for before/after |
| `AUDIT_AND_DECISIONS.md` | Audit, design decisions, model limitations, PR plan |
| `CLAUDE_CODE_PROMPTS.md` | Five prompts, one per PR, to paste into Claude Code in order |
| `screenshots/` | The eight screens, captured at 1440px: strategist list · row disclosure · deep audit view · opportunity → PIs · compare · outreach recipients · empty & degraded · the PI's own view |

Open the `.dc.html` files in a browser directly.
