"use strict";
const CACHE_NAME = "planning-resto-v2";
const APP_SHELL = [
  "app.html",
  "login.html",
  "signup.html",
  "style.css",
  "app.js",
  "manifest.json",
  "icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Reseau d'abord : les utilisateurs recoivent la derniere version de l'app
// des qu'ils sont en ligne, le cache ne sert que de secours hors connexion.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // toujours en reseau, jamais en cache
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("app.html");
        return Response.error();
      })
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Mon Planning Resto", body: "" };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Mon Planning Resto", {
      body: data.body || "",
      icon: "icons/icon.svg",
      badge: "icons/icon.svg",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      for (const client of clients) {
        if (client.url.includes("app.html")) return client.focus();
      }
      return self.clients.openWindow("app.html");
    })
  );
});
