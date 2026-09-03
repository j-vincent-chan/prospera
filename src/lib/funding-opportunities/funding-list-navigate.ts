/** Pure list-state helpers kept from the retired funding hook (used by tests and future clients). */
import {
  DEFAULT_FUNDING_LIST_PAGE,
  isDepartmentSubsEmpty,
  quickFilterSidebarResetPatch,
  type FundingListClientState,
} from "@/lib/funding-opportunities/funding-list-url";

export function mergeFundingListClientState(
  base: FundingListClientState,
  patch: Partial<FundingListClientState>
): FundingListClientState {
  const next: FundingListClientState = { ...base, ...patch };
  if (patch.rd !== undefined) next.rd = patch.rd;
  if (patch.allDepartments === true) {
    next.allDepartments = true;
    next.noDepartmentsSelected = false;
  } else if (patch.allDepartments === false) {
    next.allDepartments = false;
  }
  if (patch.noDepartmentsSelected === true) {
    next.noDepartmentsSelected = true;
    next.allDepartments = false;
  } else if (patch.noDepartmentsSelected === false) {
    next.noDepartmentsSelected = false;
  }
  if (
    patch.departments !== undefined ||
    patch.departmentSubs !== undefined ||
    patch.legacyAgencies !== undefined
  ) {
    const hasDept =
      (next.departments?.length ?? 0) > 0 ||
      !isDepartmentSubsEmpty(next.departmentSubs) ||
      (next.legacyAgencies?.length ?? 0) > 0;
    if (hasDept) {
      next.allDepartments = false;
      next.noDepartmentsSelected = false;
    }
  }
  return next;
}

export function buildNextFundingListState(
  base: FundingListClientState,
  patch: Partial<FundingListClientState>,
  options?: { resetSidebar?: boolean }
): FundingListClientState {
  let next = mergeFundingListClientState(base, patch);
  if (options?.resetSidebar && !next.savedSearchId) {
    next = mergeFundingListClientState(next, quickFilterSidebarResetPatch(next.tabs));
  }
  if (patch.page === undefined) {
    next.page = DEFAULT_FUNDING_LIST_PAGE;
  }
  return next;
}

/**
 * URL updates for the funding list. Uses startTransition so the UI stays responsive
 * while the App Router fetches the next server-rendered page.
 */
