// Constant-time compare of two strings via SHA-256, same check the sync code has always used.

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
}

export async function sameSecret(a, b) {
  const x = await digest(a), y = await digest(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
