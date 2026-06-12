"use strict";
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const store = require("./store");
const push = require("./push");
const { startReminders } = require("./reminders");
const {
  hashPassword,
  verifyPassword,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  requireManager,
} = require("./auth");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, "0");
const isoDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const pointageKey = (id, dateStr) => id + "_" + dateStr;

async function notifyEmployee(restaurantId, employeeId, payload) {
  const users = store.getUsers();
  const user = users.find(u => u.restaurantId === restaurantId && u.role === "employee" && u.employeeId === employeeId);
  if (!user || !user.pushSubscriptions || !user.pushSubscriptions.length) return;
  for (const sub of user.pushSubscriptions) {
    const ok = await push.sendNotification(sub, payload);
    if (!ok) store.removeSubscriptionByEndpoint(sub.endpoint);
  }
}

async function notifyManagers(restaurantId, payload) {
  const users = store.getUsers();
  for (const user of users.filter(u => u.restaurantId === restaurantId && u.role === "manager")) {
    if (!user.pushSubscriptions || !user.pushSubscriptions.length) continue;
    for (const sub of user.pushSubscriptions) {
      const ok = await push.sendNotification(sub, payload);
      if (!ok) store.removeSubscriptionByEndpoint(sub.endpoint);
    }
  }
}

async function notifyAllEmployees(restaurantId, payload) {
  const users = store.getUsers();
  for (const user of users.filter(u => u.restaurantId === restaurantId && u.role === "employee")) {
    if (!user.pushSubscriptions || !user.pushSubscriptions.length) continue;
    for (const sub of user.pushSubscriptions) {
      const ok = await push.sendNotification(sub, payload);
      if (!ok) store.removeSubscriptionByEndpoint(sub.endpoint);
    }
  }
}

/* ---------- Auth ---------- */
app.post("/api/auth/register", (req, res) => {
  const { restaurantName, email, password } = req.body || {};
  if (!restaurantName || !email || !password) {
    return res.status(400).json({ error: "Nom du restaurant, email et mot de passe requis." });
  }
  const users = store.getUsers();
  if (users.find(u => u.login.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "Cet email est deja utilise." });
  }
  const restaurantId = uid();
  const user = {
    id: uid(),
    restaurantId,
    role: "manager",
    employeeId: null,
    login: String(email).toLowerCase(),
    passwordHash: hashPassword(password),
    nom: "Gerant",
  };
  users.push(user);
  store.saveUsers(users);
  store.saveRestaurantState(restaurantId, store.emptyState(restaurantName));

  setAuthCookie(res, { id: user.id, restaurantId, role: "manager", employeeId: null, nom: user.nom });
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  const users = store.getUsers();
  const user = users.find(u => u.login.toLowerCase() === String(login).toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }
  setAuthCookie(res, {
    id: user.id,
    restaurantId: user.restaurantId,
    role: user.role,
    employeeId: user.employeeId,
    nom: user.nom,
  });
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  res.json({
    role: req.user.role,
    nom: req.user.nom,
    employeeId: req.user.employeeId,
    restaurantName: state.name,
  });
});

/* ---------- Etat (planning, equipe, conges, paie) ---------- */
app.get("/api/state", requireAuth, (req, res) => {
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  if (req.user.role === "manager") return res.json(state);

  // Employe : vue filtree
  const empId = req.user.employeeId;
  const today = isoDate(new Date());
  const filtered = {
    name: state.name,
    employees: state.employees,
    shifts: state.shifts,
    presets: [],
    absences: state.absences,
    pointages: {},
    location: state.location || null,
    openShifts: (state.openShifts || []).filter(o => o.date >= today),
  };
  for (const [k, v] of Object.entries(state.pointages || {})) {
    if (k.startsWith(empId + "_")) filtered.pointages[k] = v;
  }
  res.json(filtered);
});

app.put("/api/state", requireAuth, requireManager, async (req, res) => {
  const body = req.body || {};
  if (!body.employees || !body.shifts) return res.status(400).json({ error: "Donnees invalides." });
  const current = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  const next = {
    name: current.name,
    employees: body.employees,
    shifts: body.shifts,
    absences: body.absences || [],
    presets: body.presets || [],
    pointages: body.pointages || {},
    location: current.location || null,
    openShifts: current.openShifts || [],
  };

  // Detecter les changements de planning a venir pour notifier les employes concernes
  const today = isoDate(new Date());
  const changedEmployees = new Set();
  const allKeys = new Set([...Object.keys(current.shifts || {}), ...Object.keys(next.shifts)]);
  for (const k of allKeys) {
    const sep = k.lastIndexOf("_");
    const dateStr = k.slice(sep + 1);
    if (dateStr < today) continue;
    const before = JSON.stringify(current.shifts ? current.shifts[k] || [] : []);
    const after = JSON.stringify(next.shifts[k] || []);
    if (before !== after) changedEmployees.add(k.slice(0, sep));
  }

  store.saveRestaurantState(req.user.restaurantId, next);
  res.json({ ok: true });

  for (const empId of changedEmployees) {
    await notifyEmployee(req.user.restaurantId, empId, {
      title: "📅 Planning mis à jour",
      body: "Ton planning a changé, va jeter un œil !",
    });
  }
});

/* ---------- Pointage ---------- */
app.post("/api/state/punch", requireAuth, (req, res) => {
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  let empId = req.body && req.body.empId;
  const loc = req.body && req.body.loc;
  const hasLoc = loc && typeof loc.lat === "number" && typeof loc.lng === "number";

  if (req.user.role === "employee") {
    empId = req.user.employeeId;
  }
  if (!empId) return res.status(400).json({ error: "Employe manquant." });
  const employee = state.employees.find(e => e.id === empId);
  if (!employee) return res.status(404).json({ error: "Employe inconnu." });

  const now = new Date();
  const hhmm = pad(now.getHours()) + ":" + pad(now.getMinutes());

  // chercher un pointage ouvert (aujourd'hui ou hier, service apres minuit)
  let open = null;
  for (const d of [isoDate(now), isoDate(addDays(now, -1))]) {
    const list = state.pointages[pointageKey(empId, d)] || [];
    const i = list.findIndex(p => p.in && !p.out);
    if (i >= 0) { open = { dateStr: d, idx: i, entry: list[i] }; break; }
  }

  if (open) {
    open.entry.out = hhmm;
    if (hasLoc) open.entry.outLoc = loc;
  } else {
    const k = pointageKey(empId, isoDate(now));
    const entry = { in: hhmm, out: null };
    if (hasLoc) entry.inLoc = loc;
    (state.pointages[k] = state.pointages[k] || []).push(entry);
  }

  store.saveRestaurantState(req.user.restaurantId, state);
  res.json({ ok: true, hhmm, type: open ? "out" : "in" });
});

/* ---------- Demandes de conges ---------- */
app.post("/api/absences/request", requireAuth, async (req, res) => {
  const { du, au, type, motif } = req.body || {};
  if (!du || !au || !type) return res.status(400).json({ error: "Dates et type requis." });
  const empId = req.user.employeeId;
  if (!empId) return res.status(400).json({ error: "Reserve aux employes." });
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  const absence = { id: uid(), empId, du, au, type, motif: motif || "", status: "en_attente" };
  state.absences.push(absence);
  store.saveRestaurantState(req.user.restaurantId, state);
  res.json(absence);

  await notifyManagers(req.user.restaurantId, {
    title: "🌴 Nouvelle demande de congé",
    body: req.user.nom + " a fait une demande de congé.",
  });
});

app.put("/api/absences/:id/status", requireAuth, requireManager, async (req, res) => {
  const { status } = req.body || {};
  if (status !== "approuve" && status !== "refuse") return res.status(400).json({ error: "Statut invalide." });
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  const absence = state.absences.find(a => a.id === req.params.id);
  if (!absence) return res.status(404).json({ error: "Demande introuvable." });
  absence.status = status;
  store.saveRestaurantState(req.user.restaurantId, state);
  res.json(absence);

  await notifyEmployee(req.user.restaurantId, absence.empId, {
    title: "🌴 Demande de congé",
    body: "Ta demande de congé a été " + (status === "approuve" ? "approuvée" : "refusée") + ".",
  });
});

/* ---------- Creneaux de derniere minute ---------- */
app.post("/api/open-shifts", requireAuth, requireManager, async (req, res) => {
  const { date, debut, fin, poste, note } = req.body || {};
  if (!date || !debut || !fin || !poste) return res.status(400).json({ error: "Date, horaires et poste requis." });
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  const openShift = { id: uid(), date, debut, fin, poste, note: note || "" };
  state.openShifts = state.openShifts || [];
  state.openShifts.push(openShift);
  store.saveRestaurantState(req.user.restaurantId, state);
  res.json(openShift);

  await notifyAllEmployees(req.user.restaurantId, {
    title: "🆘 Créneau disponible",
    body: "Le " + date + " de " + debut + " à " + fin + " (" + poste + "). Premier arrivé, premier servi !",
  });
});

app.delete("/api/open-shifts/:id", requireAuth, requireManager, (req, res) => {
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  state.openShifts = (state.openShifts || []).filter(o => o.id !== req.params.id);
  store.saveRestaurantState(req.user.restaurantId, state);
  res.json({ ok: true });
});

app.post("/api/open-shifts/:id/claim", requireAuth, async (req, res) => {
  const empId = req.user.employeeId;
  if (!empId) return res.status(400).json({ error: "Reserve aux employes." });
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  state.openShifts = state.openShifts || [];
  const openShift = state.openShifts.find(o => o.id === req.params.id);
  if (!openShift) return res.status(404).json({ error: "Créneau introuvable ou déjà pris." });

  const k = pointageKey(empId, openShift.date);
  (state.shifts[k] = state.shifts[k] || []).push({ debut: openShift.debut, fin: openShift.fin });
  state.openShifts = state.openShifts.filter(o => o.id !== req.params.id);
  store.saveRestaurantState(req.user.restaurantId, state);
  res.json({ ok: true });

  await notifyManagers(req.user.restaurantId, {
    title: "✅ Créneau pris",
    body: req.user.nom + " a pris le créneau du " + openShift.date + " (" + openShift.debut + "–" + openShift.fin + ").",
  });
});

/* ---------- Comptes employes ---------- */
app.get("/api/users", requireAuth, requireManager, (req, res) => {
  const users = store.getUsers()
    .filter(u => u.restaurantId === req.user.restaurantId && u.role === "employee")
    .map(u => ({ id: u.id, employeeId: u.employeeId, login: u.login, nom: u.nom }));
  res.json(users);
});

app.post("/api/users", requireAuth, requireManager, (req, res) => {
  const { employeeId, login, password } = req.body || {};
  if (!employeeId || !login || !password) {
    return res.status(400).json({ error: "Employe, identifiant et code requis." });
  }
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: "Employe inconnu." });

  const users = store.getUsers();
  if (users.find(u => u.login.toLowerCase() === String(login).toLowerCase())) {
    return res.status(409).json({ error: "Cet identifiant est deja utilise." });
  }
  const user = {
    id: uid(),
    restaurantId: req.user.restaurantId,
    role: "employee",
    employeeId,
    login: String(login).toLowerCase(),
    passwordHash: hashPassword(password),
    nom: employee.nom,
  };
  users.push(user);
  store.saveUsers(users);
  res.json({ id: user.id, employeeId: user.employeeId, login: user.login, nom: user.nom });
});

app.delete("/api/users/:id", requireAuth, requireManager, (req, res) => {
  let users = store.getUsers();
  const target = users.find(u => u.id === req.params.id && u.restaurantId === req.user.restaurantId);
  if (!target) return res.status(404).json({ error: "Compte introuvable." });
  users = users.filter(u => u.id !== req.params.id);
  store.saveUsers(users);
  res.json({ ok: true });
});

/* ---------- Position du restaurant ---------- */
app.put("/api/restaurant/location", requireAuth, requireManager, (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "Position invalide." });
  }
  const state = store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
  state.location = { lat, lng };
  store.saveRestaurantState(req.user.restaurantId, state);
  res.json({ ok: true, location: state.location });
});

/* ---------- Notifications push ---------- */
app.get("/api/push/public-key", (req, res) => {
  res.json({ publicKey: push.getPublicKey() });
});

app.post("/api/push/subscribe", requireAuth, (req, res) => {
  const subscription = req.body && req.body.subscription;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: "Abonnement invalide." });
  store.addSubscription(req.user.id, subscription);
  res.json({ ok: true });
});

app.delete("/api/push/subscribe", requireAuth, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: "Endpoint manquant." });
  store.removeSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Serveur demarre sur http://localhost:" + PORT));
startReminders(store, push);
