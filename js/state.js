// Shared app state (single page, in memory).
export const state = {
  session: null,
  staffRows: [],   // [{ id, club_id, role, branch_id }]
  clubs: {},       // id -> club row
  club: null,      // selected club row
  role: null,      // role of the user in the selected club
  branches: [],    // branches visible in the selected club
  branchId: null,  // null = all visible branches
  isPlatformAdmin: false, // set at start from rpc is_platform_admin
  openConversation: null, // set by other views to jump into a chat
};

export function canManage() { return state.role === 'owner' || state.role === 'branch_manager'; }
export function isFrontDesk() { return state.role !== 'trainer'; }
export function currency() { return state.club ? state.club.default_currency.trim() : 'USD'; }

// Applies the selected branch filter to a query builder.
export function scoped(q, column = 'branch_id') {
  return state.branchId ? q.eq(column, state.branchId) : q;
}
