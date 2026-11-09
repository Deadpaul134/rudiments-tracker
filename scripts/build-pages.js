// Copies the static app (index.html, css/, js/, manifest, sw, icons) into dist/
// for Cloudflare Pages. Pages Functions (/api/*) are picked up from ./functions.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
for (const dir of ['css', 'js']) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
}

for (const file of ['manifest.webmanifest', 'sw.js']) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, file));
}

const iconsSrc = path.join(root, 'assets', 'icons');
if (fs.existsSync(iconsSrc)) {
  fs.cpSync(iconsSrc, path.join(out, 'assets', 'icons'), { recursive: true });
}

function list(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    return fs.statSync(p).isDirectory() ? list(p, rel) : [rel];
  });
}
console.log('dist/ ready:', list(out).join(', '));
