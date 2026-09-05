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
app.set("trust proxy", 1); // derriere le proxy Render, pour req.ip et les cookies secure
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, "0");
const isoDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const stateKey = (id, dateStr) => id + "_" + dateStr;

/* ---------- Validation ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ABS_TYPES = ["CP", "Maladie", "Sanssolde", "Autre"];
const POSTES = ["Cuisine", "Salle", "Plonge", "Bar", "Direction", "Autre"];
const MIN_PASSWORD_LENGTH = 6;

const isDateStr = s => typeof s === "string" && DATE_RE.test(s) && !isNaN(new Date(s).getTime());
const isTimeStr = s => typeof s === "string" && TIME_RE.test(s);
const cleanText = (s, max) => String(s == null ? "" : s).trim().slice(0, max);

// Valide un tableau d'horaires [{debut, fin}] ; retourne le tableau nettoye ou null
function cleanShifts(arr) {
  if (!Array.isArray(arr) || arr.length > 4) return null;
  const out = [];
  for (const s of arr) {
    if (!s || !isTimeStr(s.debut) || !isTimeStr(s.fin)) return null;
    out.push({ debut: s.debut, fin: s.fin });
  }
  return out;
}

function isApprovedAbsenceOn(state, empId, dateStr) {
  return (state.absences || []).some(a =>
    a.empId === empId && (a.status || "approuve") === "approuve" && a.du <= dateStr && dateStr <= a.au);
}

/* ---------- Anti brute-force (en memoire) ---------- */
const attempts = new Map(); // cle -> {count, resetAt}
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
  }
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > max;
}

/* ---------- Notifications push ---------- */
async function sendToUser(user, payload) {
  if (!user || !user.pushSubscriptions || !user.pushSubscriptions.length) return;
  for (const sub of user.pushSubscriptions) {
    const ok = await push.sendNotification(sub, payload);
    if (!ok) store.removeSubscriptionByEndpoint(sub.endpoint);
  }
}

async function notifyEmployee(restaurantId, employeeId, payload) {
  const user = store.getUsers().find(u =>
    u.restaurantId === restaurantId && u.role === "employee" && u.employeeId === employeeId);
  await sendToUser(user, payload);
}

async function notifyManagers(restaurantId, payload) {
  for (const user of store.getUsers().filter(u => u.restaurantId === restaurantId && u.role === "manager")) {
    await sendToUser(user, payload);
  }
}

async function notifyAllEmployees(restaurantId, payload) {
  for (const user of store.getUsers().filter(u => u.restaurantId === restaurantId && u.role === "employee")) {
    await sendToUser(user, payload);
  }
}

async function notifyPlanningChange(restaurantId, employeeIds) {
  for (const empId of employeeIds) {
    await notifyEmployee(restaurantId, empId, {
      title: "📅 Planning mis à jour",
      body: "Ton planning a changé, va jeter un œil !",
    });
  }
}

const getState = req => store.getRestaurantState(req.user.restaurantId) || store.emptyState("");
const saveState = (req, state) => store.saveRestaurantState(req.user.restaurantId, state);

/* ---------- Auth ---------- */
app.post("/api/auth/register", (req, res) => {
  if (rateLimited("register:" + req.ip, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Trop de tentatives, reessaie plus tard." });
  }
  const { restaurantName, email, password } = req.body || {};
  if (!restaurantName || !email || !password) {
    return res.status(400).json({ error: "Nom du restaurant, email et mot de passe requis." });
  }
  const emailClean = cleanText(email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
    return res.status(400).json({ error: "Adresse email invalide." });
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Le mot de passe doit faire au moins " + MIN_PASSWORD_LENGTH + " caracteres." });
  }
  const users = store.getUsers();
  if (users.find(u => u.login.toLowerCase() === emailClean)) {
    return res.status(409).json({ error: "Cet email est deja utilise." });
  }
  const restaurantId = uid();
  const user = {
    id: uid(),
    restaurantId,
    role: "manager",
    employeeId: null,
    login: emailClean,
    passwordHash: hashPassword(password),
    nom: "Gerant",
  };
  users.push(user);
  store.saveUsers(users);
  store.saveRestaurantState(restaurantId, store.emptyState(cleanText(restaurantName, 80)));

  setAuthCookie(res, user);
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  const loginClean = String(login).toLowerCase();
  const limitKey = "login:" + req.ip + ":" + loginClean;
  if (rateLimited(limitKey, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Trop de tentatives, reessaie dans quelques minutes." });
  }
  const user = store.getUsers().find(u => u.login.toLowerCase() === loginClean);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }
  attempts.delete(limitKey);
  setAuthCookie(res, user);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const state = getState(req);
  res.json({
    role: req.user.role,
    nom: req.user.nom,
    employeeId: req.user.employeeId,
    restaurantName: state.name,
  });
});

/* ---------- Etat (lecture) ---------- */
app.get("/api/state", requireAuth, (req, res) => {
  const state = getState(req);
  if (req.user.role === "manager") return res.json(state);

  // Employe : vue filtree. Jamais de taux horaire ni d'heures contrat des collegues,
  // jamais les motifs ni les types d'absence des autres (donnees medicales possibles).
  const empId = req.user.employeeId;
  const today = isoDate(new Date());
  const filtered = {
    name: state.name,
    employees: state.employees.map(e => e.id === empId
      ? { id: e.id, nom: e.nom, poste: e.poste, heuresContrat: e.heuresContrat }
      : { id: e.id, nom: e.nom, poste: e.poste }),
    shifts: state.shifts,
    presets: [],
    absences: (state.absences || []).flatMap(a => {
      if (a.empId === empId) return [a];
      if ((a.status || "approuve") !== "approuve") return [];
      return [{ id: a.id, empId: a.empId, du: a.du, au: a.au, type: "Absent", status: "approuve", motif: "" }];
    }),
    pointages: {},
    location: state.location || null,
    openShifts: (state.openShifts || []).filter(o => o.date >= today),
  };
  for (const [k, v] of Object.entries(state.pointages || {})) {
    if (k.startsWith(empId + "_")) filtered.pointages[k] = v;
  }
  res.json(filtered);
});

/* ---------- Planning (gerant) ---------- */
app.put("/api/shifts", requireAuth, requireManager, async (req, res) => {
  const { empId, date } = req.body || {};
  const shifts = cleanShifts((req.body || {}).shifts || []);
  if (!empId || !isDateStr(date) || shifts === null) {
    return res.status(400).json({ error: "Donnees invalides (employe, date, horaires)." });
  }
  const state = getState(req);
  if (!state.employees.find(e => e.id === empId)) {
    return res.status(404).json({ error: "Employe inconnu." });
  }
  const k = stateKey(empId, date);
  const before = JSON.stringify(state.shifts[k] || []);
  if (shifts.length) state.shifts[k] = shifts;
  else delete state.shifts[k];
  saveState(req, state);
  res.json({ ok: true });

  if (date >= isoDate(new Date()) && before !== JSON.stringify(shifts)) {
    await notifyPlanningChange(req.user.restaurantId, [empId]);
  }
});

app.post("/api/shifts/duplicate-week", requireAuth, requireManager, async (req, res) => {
  const { monday } = req.body || {};
  if (!isDateStr(monday)) return res.status(400).json({ error: "Date de debut de semaine invalide." });
  const state = getState(req);
  const start = new Date(monday);
  const today = isoDate(new Date());
  const changed = new Set();

  for (const e of state.employees) {
    for (let i = 0; i < 7; i++) {
      const src = state.shifts[stateKey(e.id, isoDate(addDays(start, i - 7)))];
      const dstDate = isoDate(addDays(start, i));
      const dst = stateKey(e.id, dstDate);
      const before = JSON.stringify(state.shifts[dst] || []);
      if (src && src.length) state.shifts[dst] = JSON.parse(JSON.stringify(src));
      else delete state.shifts[dst];
      if (dstDate >= today && before !== JSON.stringify(state.shifts[dst] || [])) changed.add(e.id);
    }
  }
  saveState(req, state);
  res.json({ ok: true });
  await notifyPlanningChange(req.user.restaurantId, changed);
});

/* ---------- Horaires types (gerant) ---------- */
app.post("/api/presets", requireAuth, requireManager, (req, res) => {
  const nom = cleanText((req.body || {}).nom, 40);
  const shifts = cleanShifts((req.body || {}).shifts);
  if (!nom || !shifts || !shifts.length) return res.status(400).json({ error: "Nom et horaires requis." });
  const state = getState(req);
  const preset = { id: uid(), nom, shifts };
  state.presets.push(preset);
  saveState(req, state);
  res.json(preset);
});

app.delete("/api/presets/:id", requireAuth, requireManager, (req, res) => {
  const state = getState(req);
  state.presets = (state.presets || []).filter(p => p.id !== req.params.id);
  saveState(req, state);
  res.json({ ok: true });
});

/* ---------- Equipe (gerant) ---------- */
function cleanEmployeeFields(body) {
  const out = {};
  if (body.nom !== undefined) {
    const nom = cleanText(body.nom, 60);
    if (!nom) return null;
    out.nom = nom;
  }
  if (body.poste !== undefined) out.poste = POSTES.includes(body.poste) ? body.poste : "Autre";
  if (body.heuresContrat !== undefined) {
    const h = parseFloat(body.heuresContrat);
    out.heuresContrat = isNaN(h) ? 0 : Math.min(80, Math.max(0, h));
  }
  if (body.tauxHoraire !== undefined) {
    const t = parseFloat(body.tauxHoraire);
    out.tauxHoraire = isNaN(t) ? 0 : Math.min(500, Math.max(0, t));
  }
  return out;
}

app.post("/api/employees", requireAuth, requireManager, (req, res) => {
  const fields = cleanEmployeeFields(req.body || {});
  if (!fields || !fields.nom) return res.status(400).json({ error: "Le nom est requis." });
  const state = getState(req);
  const employee = {
    id: uid(),
    nom: fields.nom,
    poste: fields.poste || "Autre",
    heuresContrat: fields.heuresContrat || 0,
    tauxHoraire: fields.tauxHoraire || 0,
  };
  state.employees.push(employee);
  saveState(req, state);
  res.json(employee);
});

app.put("/api/employees/:id", requireAuth, requireManager, (req, res) => {
  const state = getState(req);
  const employee = state.employees.find(e => e.id === req.params.id);
  if (!employee) return res.status(404).json({ error: "Employe inconnu." });
  const fields = cleanEmployeeFields(req.body || {});
  if (!fields) return res.status(400).json({ error: "Donnees invalides." });
  Object.assign(employee, fields);
  saveState(req, state);

  // garder le nom du compte de connexion synchronise
  if (fields.nom) {
    const users = store.getUsers();
    let changed = false;
    for (const u of users) {
      if (u.restaurantId === req.user.restaurantId && u.employeeId === employee.id && u.nom !== fields.nom) {
        u.nom = fields.nom;
        changed = true;
      }
    }
    if (changed) store.saveUsers(users);
  }
  res.json(employee);
});

app.delete("/api/employees/:id", requireAuth, requireManager, (req, res) => {
  const state = getState(req);
  const employee = state.employees.find(e => e.id === req.params.id);
  if (!employee) return res.status(404).json({ error: "Employe inconnu." });
  state.employees = state.employees.filter(e => e.id !== req.params.id);
  saveState(req, state);

  // revoquer aussi son compte de connexion, sinon l'acces resterait actif
  const users = store.getUsers().filter(u =>
    !(u.restaurantId === req.user.restaurantId && u.employeeId === req.params.id));
  store.saveUsers(users);
  res.json({ ok: true });
});

/* ---------- Pointage ---------- */
app.post("/api/state/punch", requireAuth, (req, res) => {
  const state = getState(req);
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
    const list = state.pointages[stateKey(empId, d)] || [];
    const i = list.findIndex(p => p.in && !p.out);
    if (i >= 0) { open = { dateStr: d, idx: i, entry: list[i] }; break; }
  }

  if (open) {
    open.entry.out = hhmm;
    if (hasLoc) open.entry.outLoc = { lat: loc.lat, lng: loc.lng };
  } else {
    const k = stateKey(empId, isoDate(now));
    const entry = { in: hhmm, out: null };
    if (hasLoc) entry.inLoc = { lat: loc.lat, lng: loc.lng };
    (state.pointages[k] = state.pointages[k] || []).push(entry);
  }

  saveState(req, state);
  res.json({ ok: true, hhmm, type: open ? "out" : "in" });
});

app.put("/api/pointages", requireAuth, requireManager, (req, res) => {
  const { empId, date, index } = req.body || {};
  if (!empId || !isDateStr(date) || !Number.isInteger(index)) {
    return res.status(400).json({ error: "Donnees invalides." });
  }
  const state = getState(req);
  const list = state.pointages[stateKey(empId, date)];
  if (!list || !list[index]) return res.status(404).json({ error: "Pointage introuvable." });
  for (const champ of ["in", "out"]) {
    if ((req.body || {})[champ] !== undefined) {
      const val = req.body[champ];
      if (val !== null && val !== "" && !isTimeStr(val)) return res.status(400).json({ error: "Heure invalide." });
      list[index][champ] = val || null;
    }
  }
  saveState(req, state);
  res.json({ ok: true });
});

app.delete("/api/pointages", requireAuth, requireManager, (req, res) => {
  const { empId, date, index } = req.body || {};
  if (!empId || !isDateStr(date) || !Number.isInteger(index)) {
    return res.status(400).json({ error: "Donnees invalides." });
  }
  const state = getState(req);
  const list = state.pointages[stateKey(empId, date)];
  if (!list || !list[index]) return res.status(404).json({ error: "Pointage introuvable." });
  list.splice(index, 1);
  if (!list.length) delete state.pointages[stateKey(empId, date)];
  saveState(req, state);
  res.json({ ok: true });
});

/* ---------- Absences / conges ---------- */
function validAbsenceBody(body) {
  const { du, au, type } = body || {};
  if (!isDateStr(du) || !isDateStr(au) || au < du) return null;
  if (!ABS_TYPES.includes(type)) return null;
  return { du, au, type, motif: cleanText(body.motif, 120) };
}

// Gerant : pose directement une absence approuvee
app.post("/api/absences", requireAuth, requireManager, (req, res) => {
  const fields = validAbsenceBody(req.body);
  const empId = (req.body || {}).empId;
  if (!fields || !empId) return res.status(400).json({ error: "Employe, dates et type requis." });
  const state = getState(req);
  if (!state.employees.find(e => e.id === empId)) return res.status(404).json({ error: "Employe inconnu." });
  const absence = { id: uid(), empId, ...fields, status: "approuve" };
  state.absences.push(absence);
  saveState(req, state);
  res.json(absence);
});

app.delete("/api/absences/:id", requireAuth, requireManager, (req, res) => {
  const state = getState(req);
  state.absences = (state.absences || []).filter(a => a.id !== req.params.id);
  saveState(req, state);
  res.json({ ok: true });
});

// Employe : demande de conge (en attente de validation)
app.post("/api/absences/request", requireAuth, async (req, res) => {
  const empId = req.user.employeeId;
  if (!empId) return res.status(400).json({ error: "Reserve aux employes." });
  const fields = validAbsenceBody(req.body);
  if (!fields) return res.status(400).json({ error: "Dates et type requis." });
  const state = getState(req);
  const absence = { id: uid(), empId, ...fields, status: "en_attente" };
  state.absences.push(absence);
  saveState(req, state);
  res.json(absence);

  await notifyManagers(req.user.restaurantId, {
    title: "🌴 Nouvelle demande de congé",
    body: req.user.nom + " a fait une demande de congé.",
  });
});

app.put("/api/absences/:id/status", requireAuth, requireManager, async (req, res) => {
  const { status } = req.body || {};
  if (status !== "approuve" && status !== "refuse") return res.status(400).json({ error: "Statut invalide." });
  const state = getState(req);
  const absence = state.absences.find(a => a.id === req.params.id);
  if (!absence) return res.status(404).json({ error: "Demande introuvable." });
  absence.status = status;
  saveState(req, state);
  res.json(absence);

  await notifyEmployee(req.user.restaurantId, absence.empId, {
    title: "🌴 Demande de congé",
    body: "Ta demande de congé a été " + (status === "approuve" ? "approuvée" : "refusée") + ".",
  });
});

/* ---------- Creneaux de derniere minute ---------- */
app.post("/api/open-shifts", requireAuth, requireManager, async (req, res) => {
  const { date, debut, fin, poste } = req.body || {};
  if (!isDateStr(date) || !isTimeStr(debut) || !isTimeStr(fin) || !POSTES.includes(poste)) {
    return res.status(400).json({ error: "Date, horaires et poste requis." });
  }
  const state = getState(req);
  const openShift = { id: uid(), date, debut, fin, poste, note: cleanText((req.body || {}).note, 100) };
  state.openShifts = state.openShifts || [];
  state.openShifts.push(openShift);
  saveState(req, state);
  res.json(openShift);

  await notifyAllEmployees(req.user.restaurantId, {
    title: "🆘 Créneau disponible",
    body: "Le " + date + " de " + debut + " à " + fin + " (" + poste + "). Premier arrivé, premier servi !",
  });
});

app.delete("/api/open-shifts/:id", requireAuth, requireManager, (req, res) => {
  const state = getState(req);
  state.openShifts = (state.openShifts || []).filter(o => o.id !== req.params.id);
  saveState(req, state);
  res.json({ ok: true });
});

app.post("/api/open-shifts/:id/claim", requireAuth, async (req, res) => {
  const empId = req.user.employeeId;
  if (!empId) return res.status(400).json({ error: "Reserve aux employes." });
  const state = getState(req);
  state.openShifts = state.openShifts || [];
  const openShift = state.openShifts.find(o => o.id === req.params.id);
  if (!openShift) return res.status(404).json({ error: "Créneau introuvable ou déjà pris." });
  if (isApprovedAbsenceOn(state, empId, openShift.date)) {
    return res.status(409).json({ error: "Tu es en absence ou en congé ce jour-là." });
  }

  const k = stateKey(empId, openShift.date);
  (state.shifts[k] = state.shifts[k] || []).push({ debut: openShift.debut, fin: openShift.fin });
  state.openShifts = state.openShifts.filter(o => o.id !== req.params.id);
  saveState(req, state);
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
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Le code doit faire au moins " + MIN_PASSWORD_LENGTH + " caracteres." });
  }
  const state = getState(req);
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) return res.status(404).json({ error: "Employe inconnu." });

  const users = store.getUsers();
  const loginClean = cleanText(login, 60).toLowerCase();
  if (!loginClean) return res.status(400).json({ error: "Identifiant invalide." });
  if (users.find(u => u.login.toLowerCase() === loginClean)) {
    return res.status(409).json({ error: "Cet identifiant est deja utilise." });
  }
  const user = {
    id: uid(),
    restaurantId: req.user.restaurantId,
    role: "employee",
    employeeId,
    login: loginClean,
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
  if (target.role === "manager") return res.status(400).json({ error: "Impossible de supprimer un compte gerant." });
  users = users.filter(u => u.id !== req.params.id);
  store.saveUsers(users);
  res.json({ ok: true });
});

/* ---------- Position du restaurant ---------- */
app.put("/api/restaurant/location", requireAuth, requireManager, (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "Position invalide." });
  }
  const state = getState(req);
  state.location = { lat, lng };
  saveState(req, state);
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
