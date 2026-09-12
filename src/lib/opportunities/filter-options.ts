import type { FundingListClientState } from "@/lib/funding-opportunities/funding-list-url";
import type { OpportunitiesListState } from "@/lib/opportunities/list-state";

/**
 * The "More filters" drawer's toggles, as pure state transitions. The page
 * builds each option's href from these on the server; the screen applies the
 * same transition to its optimistic draft when an option is clicked, so a
 * second click before the first response lands builds on the first.
 */
export type FilterGroupParam = "dept" | "ic" | "activity" | "inv" | "trial" | "collab";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function isFilterOptionOn(state: OpportunitiesListState, param: FilterGroupParam, value: string): boolean {
  const list = state.list;
  switch (param) {
    case "dept":
      return list.departments.includes(value);
    case "ic":
      return list.rd.nihIc.includes(value);
    case "activity":
      return list.rd.activityFamilies.includes(value);
    case "inv":
      return list.rd.investigatorTags.includes(value);
    case "trial":
      return list.rd.clinicalTrialMode === value;
    case "collab":
      return list.rd.collaborations.includes(value);
  }
}

export function applyFilterOption(state: OpportunitiesListState, param: FilterGroupParam, value: string): OpportunitiesListState {
  const list = state.list;
  const patch = (p: Partial<FundingListClientState>): OpportunitiesListState => ({ ...state, list: { ...list, ...p } });
  switch (param) {
    case "dept": {
      const on = list.departments.includes(value);
      const departments = toggle(list.departments, value);
      const departmentSubs = { ...list.departmentSubs };
      if (on) delete departmentSubs[value];
      return patch({ departments, departmentSubs, allDepartments: departments.length === 0, noDepartmentsSelected: false, legacyAgencies: [] });
    }
    case "ic":
      return patch({ rd: { ...list.rd, nihIc: toggle(list.rd.nihIc, value) } });
    case "activity":
      return patch({ rd: { ...list.rd, activityFamilies: toggle(list.rd.activityFamilies, value) } });
    case "inv":
      return patch({ rd: { ...list.rd, investigatorTags: toggle(list.rd.investigatorTags, value) } });
    case "trial":
      return patch({ rd: { ...list.rd, clinicalTrialMode: list.rd.clinicalTrialMode === value ? null : (value as FundingListClientState["rd"]["clinicalTrialMode"]) } });
    case "collab":
      return patch({ rd: { ...list.rd, collaborations: toggle(list.rd.collaborations, value) } });
  }
}

/** "Any", the one or two labels that are on, or "N selected". */
export function filterGroupSummary(options: Array<{ label: string; on: boolean }>): string {
  const on = options.filter((o) => o.on).map((o) => o.label);
  return on.length === 0 ? "Any" : on.length <= 2 ? on.join(", ") : `${on.length} selected`;
}
