"use strict";
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const { DATA_DIR } = require("./store");

const VAPID_FILE = path.join(DATA_DIR, "vapid.json");

function loadOrCreateKeys() {
  try {
    return JSON.parse(fs.readFileSync(VAPID_FILE, "utf8"));
  } catch (e) {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(VAPID_FILE), { recursive: true });
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), "utf8");
    return keys;
  }
}

const keys = loadOrCreateKeys();
const contact = process.env.VAPID_CONTACT || "mailto:contact@example.com";
webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);

function getPublicKey() {
  return keys.publicKey;
}

async function sendNotification(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (e) {
    return false; // abonnement expire ou invalide
  }
}

module.exports = { getPublicKey, sendNotification };
