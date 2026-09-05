"use strict";
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const store = require("./store");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const COOKIE_NAME = "token";
const TOKEN_TTL = "7d";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function setAuthCookie(res, user) {
  // Le token ne porte que l'id : le reste (role, restaurant...) est relu
  // en base a chaque requete, donc revoquer un compte coupe l'acces immediatement.
  const token = signToken({ id: user.id });
  res.cookie(COOKIE_NAME, token, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTS);
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload || !payload.id) return res.status(401).json({ error: "Non authentifie." });
  const user = store.getUserById(payload.id);
  if (!user) {
    clearAuthCookie(res);
    return res.status(401).json({ error: "Compte introuvable ou acces revoque." });
  }
  req.user = {
    id: user.id,
    restaurantId: user.restaurantId,
    role: user.role,
    employeeId: user.employeeId,
    nom: user.nom,
  };
  next();
}

function requireManager(req, res, next) {
  if (req.user.role !== "manager") return res.status(403).json({ error: "Reserve au gerant." });
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  requireManager,
  COOKIE_NAME,
};
