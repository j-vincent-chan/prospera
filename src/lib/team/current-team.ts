/**
 * Workspace context for the sidebar switcher.
 *
 * STEP 1 STUB. Teams, memberships and access requests arrive with the team
 * model in step 2; until then every signed-in user sees the single launch
 * workspace. Replace this module's body with a real query — the shape stays.
 */
export type WorkspaceRole = "Owner" | "Admin" | "Member";

export type WorkspaceSummary = {
  id: string;
  name: string;
  initials: string;
  role: WorkspaceRole;
};

export type CurrentWorkspace = WorkspaceSummary & {
  /** All workspaces the user belongs to, current one included. */
  teams: WorkspaceSummary[];
  /** Open invitations + access requests awaiting this user. */
  pendingCount: number;
};

const LAUNCH_TEAM: Omit<WorkspaceSummary, "role"> = {
  id: "launch",
  name: "OCR Research Development",
  initials: "OCR",
};

export function getCurrentWorkspace(profileRole: string | null | undefined): CurrentWorkspace {
  const role: WorkspaceRole = profileRole === "admin" ? "Owner" : "Member";
  const team = { ...LAUNCH_TEAM, role };
  return { ...team, teams: [team], pendingCount: 0 };
}
