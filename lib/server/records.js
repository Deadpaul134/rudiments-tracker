// Record storage shared by /api/sync and /api/claim.
// `sub == null` is the legacy sync-code table (`records`). A Google sub uses `user_records`.
// The legacy SQL is unchanged so the sync-code path behaves as it did before accounts existed.

import { mergeRecord } from './merge.js';

export { mergeRecord };

const key = (kind, id) => kind + '\u001f' + id;

export async function hasTable(db, name) {
  const r = await db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(name).first();
  return !!(r && r.ok);
}

export async function counts(db, sub) {
  const stmt = sub
    ? db.prepare('SELECT kind, COUNT(*) AS n FROM user_records WHERE user_sub = ?1 AND deleted = 0 GROUP BY kind').bind(sub)
    : db.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY kind');
  const r = await stmt.all();
  const out = { total: 0 };
  for (const row of r.results || []) { out[row.kind] = row.n; out.total += row.n; }
  return out;
}

export async function maxSeq(db, sub) {
  const stmt = sub
    ? db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM user_records WHERE user_sub = ?1').bind(sub)
    : db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM records');
  const r = await stmt.first();
  return (r && r.m) || 0;
}

async function loadExisting(db, sub, keys) {
  const stmt = sub
    ? db.prepare(
      "SELECT kind, id, data, deleted, updated_at FROM user_records WHERE user_sub = ?2 AND kind || char(31) || id IN (SELECT value FROM json_each(?1))"
    ).bind(JSON.stringify(keys), sub)
    : db.prepare(
      "SELECT kind, id, data, deleted, updated_at FROM records WHERE kind || char(31) || id IN (SELECT value FROM json_each(?1))"
    ).bind(JSON.stringify(keys));
  const ex = await stmt.all();
  const existing = new Map();
  for (const r of ex.results || []) {
    existing.set(key(r.kind, r.id), { deleted: r.deleted, updated_at: r.updated_at, data: r.data == null ? null : JSON.parse(r.data) });
  }
  return existing;
}

async function insertRows(db, sub, rows) {
  if (sub) {
    await db.prepare(
      `INSERT INTO user_records (user_sub, kind, id, data, deleted, updated_at, seq)
       SELECT ?2, json_extract(value, '$.k'), json_extract(value, '$.i'), json_extract(value, '$.d'),
              json_extract(value, '$.x'), json_extract(value, '$.u'),
              (SELECT COALESCE(MAX(seq), 0) FROM user_records WHERE user_sub = ?2) + CAST(key AS INTEGER) + 1
       FROM json_each(?1) WHERE 1
       ON CONFLICT(user_sub, kind, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted,
         updated_at = excluded.updated_at, seq = excluded.seq`
    ).bind(JSON.stringify(rows), sub).run();
    return;
  }
  await db.prepare(
    `INSERT INTO records (kind, id, data, deleted, updated_at, seq)
     SELECT json_extract(value, '$.k'), json_extract(value, '$.i'), json_extract(value, '$.d'),
            json_extract(value, '$.x'), json_extract(value, '$.u'),
            (SELECT COALESCE(MAX(seq), 0) FROM records) + CAST(key AS INTEGER) + 1
     FROM json_each(?1) WHERE 1
     ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted,
       updated_at = excluded.updated_at, seq = excluded.seq`
  ).bind(JSON.stringify(rows)).run();
}

// list items: {kind, id, deleted, data, updated_at}. Returns how many rows were written.
export async function applyChanges(db, sub, list) {
  const byKey = new Map();
  for (const c of list) {
    byKey.set(key(c.kind, c.id), {
      kind: c.kind, id: c.id, deleted: !!c.deleted, data: c.deleted ? null : c.data, updated_at: c.updated_at,
    });
  }
  if (!byKey.size) return 0;
  const existing = await loadExisting(db, sub, [...byKey.keys()]);
  const rows = [];
  for (const [, inc] of byKey) {
    const m = mergeRecord(existing.get(key(inc.kind, inc.id)), inc);
    if (m) rows.push({ k: inc.kind, i: inc.id, d: m.deleted ? null : JSON.stringify(m.data), x: m.deleted ? 1 : 0, u: m.updated_at });
  }
  if (!rows.length) return 0;
  await insertRows(db, sub, rows);
  return rows.length;
}

export async function pullRows(db, sub, since) {
  const stmt = sub
    ? db.prepare('SELECT kind, id, data, deleted, updated_at, seq FROM user_records WHERE user_sub = ?2 AND seq > ?1 ORDER BY seq').bind(since, sub)
    : db.prepare('SELECT kind, id, data, deleted, updated_at, seq FROM records WHERE seq > ?1 ORDER BY seq').bind(since);
  return stmt.all();
}

export async function readClaim(db) {
  if (!(await hasTable(db, 'legacy_claim'))) return null;
  return db.prepare('SELECT user_sub, claimed_at FROM legacy_claim WHERE id = 1').first();
}

// Insert the single claim row. Same user may retry (copy is idempotent). Anyone else is rejected.
export async function lockClaim(db, sub, now) {
  const existing = await readClaim(db);
  if (existing && existing.user_sub !== sub) return { error: 'already-claimed' };
  if (existing && existing.user_sub === sub) return { already: true };
  try {
    await db.prepare('INSERT INTO legacy_claim (id, user_sub, claimed_at) VALUES (1, ?1, ?2)').bind(sub, now).run();
  } catch (e) {
    const again = await readClaim(db);
    if (!again || again.user_sub !== sub) return { error: 'already-claimed' };
    return { already: true };
  }
  return { already: false };
}

// Copy legacy rows into this user's table. Does not update or delete `records`.
export async function copyLegacyToUser(db, sub) {
  const all = await db.prepare('SELECT kind, id, data, deleted, updated_at FROM records').all();
  const list = [];
  for (const r of all.results || []) {
    if (r.deleted) {
      list.push({ kind: r.kind, id: r.id, deleted: true, data: null, updated_at: r.updated_at });
      continue;
    }
    if (r.data == null) continue;
    let data;
    try { data = JSON.parse(r.data); } catch (e) { continue; }
    list.push({ kind: r.kind, id: r.id, deleted: false, data, updated_at: r.updated_at });
  }
  return applyChanges(db, sub, list);
}

export async function upsertUser(db, user, now) {
  const email = user.email || '';
  const name = user.name || '';
  await db.prepare(
    `INSERT INTO users (sub, email, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(sub) DO UPDATE SET
       email = CASE WHEN excluded.email != '' THEN excluded.email ELSE users.email END,
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END,
       updated_at = excluded.updated_at`
  ).bind(user.sub, email, name, now).run();
}
