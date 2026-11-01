// Public config for the static app. The Google client id is not a secret (it ships in the
// browser), but it is read from the environment so it is never committed.
// GET /api/config -> {ok, googleClientId}

import { json, options } from '../../lib/server/http.js';

export function onRequestOptions() {
  return options();
}

export function onRequestGet({ env }) {
  const googleClientId = env && typeof env.GOOGLE_CLIENT_ID === 'string' ? env.GOOGLE_CLIENT_ID : '';
  return json({ ok: true, googleClientId });
}
