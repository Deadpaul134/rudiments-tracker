// Minimal D1-shaped adapter over Node's built-in SQLite, so the real Pages Function runs in tests.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const MIG_DIR = path.resolve(__dirname, '..', 'migrations');
const FUNCTION_URL = pathToFileURL(path.resolve(__dirname, '..', 'functions', 'api', 'sync.js')).href;
const CONFIG_URL = pathToFileURL(path.resolve(__dirname, '..', 'functions', 'api', 'config.js')).href;
const CLAIM_URL = pathToFileURL(path.resolve(__dirname, '..', 'functions', 'api', 'claim.js')).href;

function plain(row) { return row ? { ...row } : row; }

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args).map(plain), meta: {} }; }
  async first(col) { const r = plain(this.db.prepare(this.sql).get(...this.args)); if (!r) return null; return col ? r[col] : r; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
}

function createD1(opts) {
  const db = new DatabaseSync(':memory:');
  let files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (opts && opts.until) files = files.filter((f) => f <= opts.until);
  for (const f of files) db.exec(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
  return {
    raw: db,
    prepare(sql) { return new Stmt(db, sql); },
    async batch(stmts) { return Promise.all(stmts.map((s) => s.all())); },
  };
}

let fnPromise;
function loadFunction() { return (fnPromise ||= import(FUNCTION_URL)); }

/** Route a Playwright page's calls to `url` into the real function backed by `env`. */
async function moduleFor(pathname) {
  if (pathname.endsWith('/api/config')) return import(CONFIG_URL);
  if (pathname.endsWith('/api/claim')) return import(CLAIM_URL);
  return loadFunction();
}

async function routeToFunction(page, url, env, hook) {
  await page.route((u) => u.href.startsWith(url), async (route) => {
    const req = route.request();
    if (hook) { const r = await hook(req); if (r === 'abort') return route.abort('internetdisconnected'); }
    const request = new Request(req.url(), { method: req.method(), headers: req.headers(), body: ['GET', 'OPTIONS', 'HEAD'].includes(req.method()) ? undefined : req.postData() });
    const fn = await moduleFor(new URL(req.url()).pathname);
    const name = { GET: 'onRequestGet', POST: 'onRequestPost', OPTIONS: 'onRequestOptions' }[req.method()];
    const res = await fn[name]({ request, env });
    const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    return route.fulfill({ status: res.status, headers, body: await res.text() });
  });
}

module.exports = { createD1, loadFunction, routeToFunction };
