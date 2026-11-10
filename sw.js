/* Rudiments Tracker service worker: versioned app-shell cache for offline;
   network-first HTML. Never cache or intercept /api/*, Google auth, or non-GET. */
"use strict";
var VERSION = "rt-v3";
var APP = "rt-app-" + VERSION;
var FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/data.js",
  "js/audio.js",
  "js/sync.js",
  "js/practice.js",
  "js/recorder.js",
  "js/app.js",
  "assets/icons/logo.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-192.png",
  "assets/icons/maskable-512.png",
  "assets/icons/favicon-32.png",
  "assets/icons/apple-touch-180.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(APP).then(function (c) {
      return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== APP; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function shouldBypass(url) {
  // Never touch API (D1 sync / config / claim), Google Identity, or fonts CDNs used at auth time
  if (/\/api\//.test(url)) return true;
  return /googleapis\.com|gstatic\.com|accounts\.google\.com|google\.com\/gsi|securetoken|identitytoolkit/.test(url);
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return; // never intercept POST (sync writes)
  var url = req.url;
  if (shouldBypass(url)) return;
  if (new URL(url).origin !== self.location.origin) return;

  if (req.mode === "navigate" || (req.headers.get("accept") && req.headers.get("accept").indexOf("text/html") !== -1)) {
    e.respondWith(
      fetch(req).then(function (r) {
        var cp = r.clone();
        caches.open(APP).then(function (c) { c.put("index.html", cp); });
        return r;
      }).catch(function () {
        return caches.match("index.html", { ignoreSearch: true });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req).then(function (r) {
        if (r && r.ok) {
          var cp = r.clone();
          caches.open(APP).then(function (c) { c.put(req, cp); });
        }
        return r;
      });
    })
  );
});
