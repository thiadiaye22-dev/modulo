"use strict";

// Impression par le pilote Brother installé sur Windows.
//
// L'envoi direct du protocole raster sur le port 9100 n'a jamais abouti sur la
// QL-820NWBc : l'imprimante accepte les commandes, avance le papier, mais
// n'imprime pas les points. Plutôt que de continuer à deviner l'encodage
// attendu, on confie l'étiquette au pilote Brother, qui sait le produire.
//
// Le pilote est piloté depuis PowerShell, présent sur tout Windows.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'pilote.ps1');

const disponible = () => process.platform === 'win32';

function executerPowerShell(args, delai) {
  return new Promise((resoudre) => {
    const p = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, ...args
    ], { windowsHide: true });

    let sortie = '', erreur = '';
    const minuteur = setTimeout(() => { p.kill(); }, delai || 30000);

    p.stdout.on('data', (c) => { sortie += c.toString(); });
    p.stderr.on('data', (c) => { erreur += c.toString(); });
    p.on('error', (e) => {
      clearTimeout(minuteur);
      resoudre({ ok: false, erreur: 'PowerShell introuvable : ' + e.message });
    });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      resoudre({
        ok: code === 0,
        code,
        sortie: sortie.trim(),
        erreur: erreur.trim() || (code === 0 ? '' : `PowerShell a terminé avec le code ${code}`)
      });
    });
  });
}

// Une imprimante d'étiquettes Brother se reconnaît à son nom : la gamme QL,
// ou la marque suivie d'un modèle d'étiqueteuse.
const estEtiqueteuseBrother = (nom) => /\bQL[-\s]?\d/i.test(nom) || /brother.*(QL|label)/i.test(nom);

/**
 * Liste les imprimantes connues de Windows, en signalant celles qui sont des
 * étiqueteuses Brother.
 */
async function listerImprimantes() {
  if (!disponible()) return { ok: false, erreur: 'disponible uniquement sous Windows' };
  const r = await executerPowerShell(['-Action', 'Lister'], 15000);
  if (!r.ok) return { ok: false, erreur: r.erreur };
  const toutes = r.sortie.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return { ok: true, toutes, brother: toutes.filter(estEtiqueteuseBrother) };
}

/**
 * Imprime une image PNG par le pilote, à sa taille physique exacte.
 *
 * @param {Buffer} png
 * @param {{imprimante: string, largeurPoints: number, hauteurPoints: number, ppp?: number, copies?: number}} opt
 */
async function imprimerPng(png, opt) {
  if (!disponible()) return { ok: false, erreur: 'disponible uniquement sous Windows' };
  if (!opt || !opt.imprimante) return { ok: false, erreur: 'nom d\'imprimante manquant' };
  if (!opt.hauteurPoints) return { ok: false, erreur: 'hauteur manquante' };

  const fichier = path.join(os.tmpdir(),
    `etiquette-dlc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  fs.writeFileSync(fichier, png);

  try {
    const r = await executerPowerShell([
      '-Action', 'Imprimer',
      '-Fichier', fichier,
      '-Imprimante', opt.imprimante,
      '-LargeurPx', String(opt.largeurPoints || 696),
      '-HauteurPx', String(opt.hauteurPoints),
      '-Ppp', String(opt.ppp || 300),
      '-Copies', String(opt.copies || 1)
    ], 60000);

    if (!r.ok) return { ok: false, erreur: r.erreur || 'échec de l\'impression' };
    return { ok: true, detail: r.sortie };
  } finally {
    // Le fichier temporaire n'a plus d'utilité une fois le travail remis au
    // spouleur ; on ne bloque pas si Windows le tient encore ouvert.
    try { fs.unlinkSync(fichier); } catch (e) {}
  }
}

module.exports = { disponible, listerImprimantes, imprimerPng, estEtiqueteuseBrother };
