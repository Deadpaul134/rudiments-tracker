// Last-change-wins merge. A clean max (clean / hard) never drops when two live
// measurements of the same entry meet. Kept identical to the original sync rule.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isWork = (d) => isObj(d) && d.kind === 'work';

export function mergeRecord(existing, incoming) {
  const inc = { deleted: incoming.deleted ? 1 : 0, data: incoming.deleted ? null : incoming.data, updated_at: incoming.updated_at };
  if (!existing) return inc;
  const ex = { deleted: existing.deleted ? 1 : 0, data: existing.data, updated_at: existing.updated_at };
  let win = inc.updated_at >= ex.updated_at ? inc : ex;
  const lose = win === inc ? ex : inc;
  if (incoming.kind === 'e' && !win.deleted && !lose.deleted && isObj(win.data) && isObj(lose.data) &&
      !isWork(win.data) && !isWork(lose.data)) {
    const d = { ...win.data };
    for (const f of ['clean', 'hard']) {
      const a = +win.data[f] || 0, b = +lose.data[f] || 0;
      if (b > a) d[f] = lose.data[f];
    }
    win = { ...win, data: d };
  }
  const same = win.deleted === ex.deleted && JSON.stringify(win.data) === JSON.stringify(ex.data);
  if (same) return null;
  return { ...win, updated_at: Math.max(win.updated_at, ex.updated_at) };
}
