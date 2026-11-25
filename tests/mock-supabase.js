// Minimal in-memory stand-in for @supabase/supabase-js used for local UI tests only.
const DB = window.__DB || (window.__DB = {});
const RPC = window.__RPC || (window.__RPC = {});
window.__CALLS = window.__CALLS || [];
const uid = () => 'id-' + Math.random().toString(36).slice(2, 10);

function getPath(row, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), row); }

class Q {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.payload = null; this._order = []; this._limit = null; this._single = null; this._count = false; this._head = false; }
  select(_c, opts) { if (this.op === 'select') this.op = 'select'; if (opts && opts.count) this._count = true; if (opts && opts.head) this._head = true; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  upsert(p) { this.op = 'insert'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => getPath(r, c) === v); return this; }
  neq(c, v) { this.filters.push((r) => getPath(r, c) !== v); return this; }
  in(c, a) { this.filters.push((r) => a.includes(getPath(r, c))); return this; }
  gte(c, v) { this.filters.push((r) => getPath(r, c) >= v); return this; }
  gt(c, v) { this.filters.push((r) => getPath(r, c) > v); return this; }
  lte(c, v) { this.filters.push((r) => getPath(r, c) <= v); return this; }
  lt(c, v) { this.filters.push((r) => getPath(r, c) < v); return this; }
  is(c, v) { this.filters.push((r) => (getPath(r, c) ?? null) === v); return this; }
  not(c, op, v) { if (op === 'is') this.filters.push((r) => (getPath(r, c) ?? null) !== v); return this; }
  ilike(c, v) { const s = String(v).replace(/%/g, '').toLowerCase(); this.filters.push((r) => String(getPath(r, c) ?? '').toLowerCase().includes(s)); return this; }
  or() { return this; }
  contains() { return this; }
  order(c, o) { this._order.push([c, !(o && o.ascending === false)]); return this; }
  limit(n) { this._limit = n; return this; }
  range(a, b) { this._limit = b - a + 1; return this; }
  single() { this._single = 'single'; return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  then(res, rej) { return this._run().then(res, rej); }
  async _run() {
    window.__CALLS.push({ t: this.table, op: this.op });
    const rows = DB[this.table] || (DB[this.table] = []);
    if (this.op === 'insert') { const arr = [].concat(this.payload).map((p) => ({ id: uid(), ...p })); rows.push(...arr); return { data: arr, error: null }; }
    let m = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') { m.forEach((r) => Object.assign(r, this.payload)); return { data: m, error: null }; }
    if (this.op === 'delete') { DB[this.table] = rows.filter((r) => !m.includes(r)); return { data: m, error: null }; }
    for (const [c, asc] of [...this._order].reverse()) m = [...m].sort((a, b) => (getPath(a, c) > getPath(b, c) ? 1 : -1) * (asc ? 1 : -1));
    if (this._limit != null) m = m.slice(0, this._limit);
    const count = this._count ? m.length : null;
    if (this._head) return { data: null, count, error: null };
    if (this._single === 'single') return m.length ? { data: m[0], count, error: null } : { data: null, error: { message: 'no rows' } };
    if (this._single === 'maybe') return { data: m[0] || null, count, error: null };
    return { data: m, count, error: null };
  }
}

const session = { access_token: 'x', refresh_token: 'y', user: { id: 'u-owner', email: 'owner@club.test' } };
const listeners = [];
export function createClient() {
  return {
    from: (t) => new Q(t),
    rpc: async (fn, args) => {
      window.__CALLS.push({ rpc: fn, args });
      const h = RPC[fn];
      if (typeof h === 'function') { try { return { data: h(args), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } }
      return { data: h !== undefined ? h : [], error: null };
    },
    auth: {
      getSession: async () => ({ data: { session: window.__NOSESSION ? null : session } }),
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => { window.__NOSESSION = false; return { error: null }; },
      getUser: async () => ({ data: { user: session.user }, error: null }),
      updateUser: async () => ({ error: null }),
      setSession: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }),
        listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
      },
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }), createSignedUrls: async () => ({ data: [], error: null }), upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe() {} }; return c; },
    removeChannel: async () => {},
  };
}
