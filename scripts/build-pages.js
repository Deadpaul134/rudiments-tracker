// Copies only the static app (index.html, css/, js/) into dist/ for Cloudflare Pages.
// The /api/sync function is picked up from ./functions by Cloudflare itself.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
for (const dir of ['css', 'js']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
console.log('dist/ ready:', fs.readdirSync(out).join(', '));
