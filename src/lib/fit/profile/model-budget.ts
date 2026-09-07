/**
 * A count of model calls a build — or a whole cron run, when one object is
 * shared across builds — may still make. One class for both profile builders:
 * the investigator profile (PR 1.4: `buildInvestigatorFitProfile`,
 * `syncInvestigatorFitProfiles`) and the opportunity profile (PR 1.5: the
 * notice extractor, the exemplar classifier, `runOpportunityProfiles`).
 * `investigator.ts` and `opportunity-extract.ts` re-export it, so callers of
 * either module keep their import.
 */
export class ModelBudget {
  used = 0;
  constructor(public remaining: number) {}
  get exhausted(): boolean {
    return this.remaining <= 0;
  }
  /** Reserve one call; false when none is left. */
  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    this.used += 1;
    return true;
  }
  /** Give back one reserved call that was never sent (the judge client refused to start it — PR 3.1c). */
  release(): void {
    this.remaining += 1;
    this.used = Math.max(0, this.used - 1);
  }
}
