"use strict";
const CACHE_NAME = "planning-resto-v1";
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // toujours en reseau

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
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
