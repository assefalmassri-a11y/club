const today = new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
window.__DB = {
  staff: [{ id: 's1', user_id: 'u-owner', club_id: 'c1', role: 'owner', branch_id: null }],
  clubs: [{ id: 'c1', name: 'Test Gym', slug: 'test-gym', default_currency: 'USD', timezone: 'Europe/Stockholm' }],
  branches: [{ id: 'b1', club_id: 'c1', name: 'Main', created_at: '1' }, { id: 'b2', club_id: 'c1', name: 'North', created_at: '2' }],
  members: [
    { id: 'm1', club_id: 'c1', branch_id: 'b1', full_name: 'Ahmad Test', phone: '0700', member_no: 1001, status: 'active', created_at: today },
    { id: 'm2', club_id: 'c1', branch_id: 'b2', full_name: 'Sara Test', phone: '0701', member_no: 1002, status: 'active', created_at: today },
  ],
  membership_plans: [{ id: 'p1', club_id: 'c1', name: 'Monthly', price_cents: 3000, currency: 'USD', duration_days: 30, active: true }],
  memberships: [{ id: 'ms1', club_id: 'c1', member_id: 'm1', plan_id: 'p1', starts_on: today, ends_on: addDays(5), status: 'active', price_cents: 3000, currency: 'USD' }],
  invoices: [{ id: 'i1', club_id: 'c1', member_id: 'm1', number: 'INV-1', label: 'Monthly', amount_minor: 3000, currency: 'USD', status: 'issued', issue_date: today, due_date: addDays(-2), created_at: today }],
  events: [], checkins: [], ledger_entries: [], doors: [], conversations: [], products: [], equipment: [],
};
window.__RPC = {};
