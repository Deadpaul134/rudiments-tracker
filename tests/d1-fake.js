// Minimal D1-shaped adapter over Node's built-in SQLite, so the real Pages Function runs in tests.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const MIGRATION = path.resolve(__dirname, '..', 'migrations', '0001_init.sql');
const FUNCTION_URL = pathToFileURL(path.resolve(__dirname, '..', 'functions', 'api', 'sync.js')).href;

function plain(row) { return row ? { ...row } : row; }

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args).map(plain), meta: {} }; }
  async first(col) { const r = plain(this.db.prepare(this.sql).get(...this.args)); if (!r) return null; return col ? r[col] : r; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
}

function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  return {
    raw: db,
    prepare(sql) { return new Stmt(db, sql); },
    async batch(stmts) { return Promise.all(stmts.map((s) => s.all())); },
  };
}

let fnPromise;
function loadFunction() { return (fnPromise ||= import(FUNCTION_URL)); }

/** Route a Playwright page's calls to `url` into the real function backed by `env`. */
async function routeToFunction(page, url, env, hook) {
  const fn = await loadFunction();
  await page.route((u) => u.href.startsWith(url), async (route) => {
    const req = route.request();
    if (hook) { const r = await hook(req); if (r === 'abort') return route.abort('internetdisconnected'); }
    const request = new Request(req.url(), { method: req.method(), headers: req.headers(), body: ['GET', 'OPTIONS', 'HEAD'].includes(req.method()) ? undefined : req.postData() });
    const name = { GET: 'onRequestGet', POST: 'onRequestPost', OPTIONS: 'onRequestOptions' }[req.method()];
    const res = await fn[name]({ request, env });
    const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    return route.fulfill({ status: res.status, headers, body: await res.text() });
  });
}

module.exports = { createD1, loadFunction, routeToFunction };
