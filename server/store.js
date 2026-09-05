"use strict";
const fs = require("fs");
const path = require("path");

// DATA_DIR configurable pour pointer vers un disque persistant en production
// (ex : /var/data sur Render avec un disque monté). Par defaut : ./data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const RESTAURANTS_DIR = path.join(DATA_DIR, "restaurants");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(RESTAURANTS_DIR)) fs.mkdirSync(RESTAURANTS_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) writeJSON(USERS_FILE, []);
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function getUsers() {
  ensureDirs();
  return readJSON(USERS_FILE, []);
}

function saveUsers(users) {
  ensureDirs();
  writeJSON(USERS_FILE, users);
}

function getUserById(id) {
  return getUsers().find(u => u.id === id) || null;
}

function restaurantFile(id) {
  return path.join(RESTAURANTS_DIR, id + ".json");
}

function getRestaurantState(id) {
  ensureDirs();
  return readJSON(restaurantFile(id), null);
}

function saveRestaurantState(id, data) {
  ensureDirs();
  writeJSON(restaurantFile(id), data);
}

function emptyState(name) {
  return { name, employees: [], shifts: {}, absences: [], presets: [], pointages: {}, location: null, openShifts: [] };
}

function listRestaurantIds() {
  ensureDirs();
  return fs.readdirSync(RESTAURANTS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -5));
}

function addSubscription(userId, subscription) {
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return;
  user.pushSubscriptions = user.pushSubscriptions || [];
  if (!user.pushSubscriptions.some(s => s.endpoint === subscription.endpoint)) {
    user.pushSubscriptions.push(subscription);
  }
  saveUsers(users);
}

function removeSubscription(userId, endpoint) {
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user || !user.pushSubscriptions) return;
  user.pushSubscriptions = user.pushSubscriptions.filter(s => s.endpoint !== endpoint);
  saveUsers(users);
}

function removeSubscriptionByEndpoint(endpoint) {
  const users = getUsers();
  let changed = false;
  for (const user of users) {
    if (!user.pushSubscriptions) continue;
    const before = user.pushSubscriptions.length;
    user.pushSubscriptions = user.pushSubscriptions.filter(s => s.endpoint !== endpoint);
    if (user.pushSubscriptions.length !== before) changed = true;
  }
  if (changed) saveUsers(users);
}

module.exports = {
  DATA_DIR,
  getUsers,
  saveUsers,
  getUserById,
  getRestaurantState,
  saveRestaurantState,
  emptyState,
  listRestaurantIds,
  addSubscription,
  removeSubscription,
  removeSubscriptionByEndpoint,
};
