# PR 2.3 · screenshots of the three surfaces for one pair

The PR 2.3 acceptance asks for screenshots of the three fit surfaces showing the **same tier for the same (investigator, notice) pair**. The preview needs an admin login, so a person captures them; this file says what to capture and what each should show. Drop the PNGs in this folder as `investigator-page.png`, `opportunity-page.png`, `opportunity-peek.png` (and `outreach-recipients.png` if the fourth is captured) and link them from the PR.

## Preconditions

1. The PR 2.2 migration `supabase/migrations/20260917100000_fit_results_and_engine_flag.sql` is applied and the sweep has run (`npm run fit:results-report -- --write`, or the nightly `/api/cron/fit-results`), so `fit_results` has rows.
2. A **test team** on the new engine: `UPDATE teams SET fit_engine = 'fit-v1' WHERE id = '<test team>'`. Every other team stays `legacy` — the plan's third human checkpoint ("before PR 2.2's flag is flipped for any team") is about the production teams; the acceptance for 2.2 already assumes a test team.
3. Sign in as a member of that team (the profile's current team is what every surface reads: `profiles.current_team_id`, else the first membership).
4. Pick one pair with a surfaced tier. The quickest way: `npm run fit:results-report -- --dry-run --investigator <uuid> --top 5` prints that investigator's best notices with tiers; take the first Strong or Moderate, note the notice's `funding_opportunities.id`. (PR 2.2's dry run had Aleksandar Rajkovic → RFA-DK-27-136 as Exploratory 59.8.)

## The three captures

| # | URL | What the screenshot must show |
|---|---|---|
| 1 | `/investigators/<investigator id>` | The **"Opportunities that fit"** card. Its aside reads exactly `Fit · paradigm, design and topic · refreshed nightly`. The chosen notice is listed with a tier pill (Strong match / Potential match / Exploratory) and the one-line rationale (an Exploratory row shows the gap sentence after it). Rows are ordered Strong, then Moderate, then Exploratory, by score inside a tier. |
| 2 | `/opportunities/<notice id>` | The right-hand **"Suggested recipients · Best fit"** card. The chosen investigator appears with the **same tier pill** and the same rationale line; under the "Review in Outreach" button the note starts `Fit · paradigm, design and topic · refreshed nightly`. No bare number anywhere in the card. |
| 3 | `/opportunities?peek=<notice id>` — or open `/opportunities`, find the notice in the list and click its row so the slide-over opens | The peek's **"Best fit in your directory"** section: the same investigator, the same tier pill, the same rationale line, and the footer line `Fit · paradigm, design and topic · refreshed nightly.` (If the list does not accept a `peek=` parameter, open it from the list; the section is near the bottom of the slide-over.) |

Optional fourth capture, the Outreach surface: save the notice to Outreach ("Review in Outreach"), open the item's Recipients tab and run suggestions; the investigator carries the same tier (the snapshot vocabulary: Moderate shows as "Potential match").

## What to check while capturing

- The tier pill's tooltip (hover) describes the fit-v1 floors, not cosine overlap ("Strong fit: every floor met …").
- Switch the signed-in profile to a **legacy** team and reload the opportunity page: the "Suggested recipients" card shows no list — only the sentence "Your team ranks people per notice in Outreach …" and the Review-in-Outreach button. The investigator page's card returns to `Fit tier · evidence similarity vs N open notices · computed when you open this page`. That is the legacy state after PR 2.3: the tag-overlap list is gone for everyone (D8), and fit-v1 output stays behind the flag.
- Before the sweep has scored the notice, the fit-v1 card says "This notice has not been scored yet — the nightly fit-results run scores it once its profile is built."; a closed notice says "This notice is closed; only open notices are scored."
