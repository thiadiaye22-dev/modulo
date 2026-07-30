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

// Les tailles remontées par le pilote sont en centièmes de pouce.
const enMm = (centiemes) => Math.round(centiemes * 0.254 * 10) / 10;

/**
 * Lit ce que le pilote déclare : ses formats de papier, ses résolutions, et la
 * zone imprimable du format par défaut.
 *
 * Sur un rouleau continu, c'est l'information qui manque le plus : si le pilote
 * n'accepte pas de format sur mesure, l'étiquette sort à la longueur de son
 * format par défaut, et il faut alors lui imposer un de ses propres formats.
 */
async function listerFormats(imprimante) {
  if (!disponible()) return { ok: false, erreur: 'disponible uniquement sous Windows' };
  if (!imprimante) return { ok: false, erreur: 'nom d\'imprimante manquant' };

  const r = await executerPowerShell(['-Action', 'Formats', '-Imprimante', imprimante], 20000);
  if (!r.ok) return { ok: false, erreur: r.erreur };
  return analyserFormats(r.sortie);
}

// Un Windows en français écrit les décimales avec une virgule (« 236,22 ») :
// on la ramène au point avant de convertir, sinon la valeur devient NaN.
const nombre = (s) => +String(s == null ? '' : s).replace(',', '.');

// Séparé de l'appel à PowerShell pour être vérifiable sans Windows.
function analyserFormats(sortie) {
  const res = { ok: true, defaut: null, zone: null, formats: [], resolutions: [] };
  sortie.split(/\r?\n/).forEach((ligne) => {
    const c = ligne.split('\t').map(s => s.trim());
    if (c[0] === 'DEFAUT') {
      res.defaut = { nom: c[1], largeur: nombre(c[2]), hauteur: nombre(c[3]), genre: c[4] };
    } else if (c[0] === 'ZONE') {
      res.zone = { x: nombre(c[1]), y: nombre(c[2]), largeur: nombre(c[3]), hauteur: nombre(c[4]) };
    } else if (c[0] === 'FORMAT') {
      res.formats.push({ nom: c[1], largeur: nombre(c[2]), hauteur: nombre(c[3]), genre: c[4] });
    } else if (c[0] === 'RESOLUTION') {
      // Les « résolutions » négatives sont les niveaux génériques de Windows
      // (brouillon, haute…), sans valeur en points par pouce : on les ignore.
      const x = nombre(c[2]), y = nombre(c[3]);
      if (x > 0 && y > 0) res.resolutions.push({ genre: c[1], x, y });
    }
  });
  return res;
}

/**
 * Choisit, parmi les formats déclarés par le pilote, celui du rouleau continu
 * de la largeur donnée — « 62mm » pour un DK-22205. C'est le format que le
 * pilote sait réellement encoder pour ce média ; un format sur mesure passe
 * la couche Windows mais peut être jeté sans un mot par l'imprimante si sa
 * description ne correspond pas au rouleau chargé.
 */
function formatPourRouleau(formats, largeurMm) {
  const exact = formats.find(f => f.nom === `${largeurMm}mm`);
  if (exact) return exact;
  // À défaut du nom exact : un format de la bonne largeur, le plus court.
  const candidats = formats
    .filter(f => Math.abs(f.largeur / 100 * 25.4 - largeurMm) < 1.5)
    .sort((a, b) => a.hauteur - b.hauteur);
  return candidats[0] || null;
}

// Codes d'état de Win32_Printer, traduits.
const ETATS_IMPRIMANTE = {
  1: 'autre', 2: 'inconnu', 3: 'prête', 4: 'impression en cours',
  5: 'préchauffage', 6: 'impression arrêtée', 7: 'hors ligne'
};
const ERREURS_IMPRIMANTE = {
  0: 'inconnue', 1: 'autre', 2: 'aucune', 3: 'papier bientôt épuisé',
  4: 'plus de papier', 5: 'niveau d\'impression faible', 6: 'consommable épuisé',
  7: 'capot ouvert', 8: 'bourrage', 9: 'hors ligne',
  10: 'intervention demandée', 11: 'bac de sortie plein'
};

/**
 * Lit l'état de la file d'attente Windows pour une imprimante : hors
 * connexion ou pas, port utilisé, travaux en attente et leur état.
 *
 * C'est le seul moyen de distinguer « le pilote a accepté le travail » de
 * « le travail est réellement parti vers l'imprimante ».
 */
async function lireFile(imprimante) {
  if (!disponible()) return { ok: false, erreur: 'disponible uniquement sous Windows' };
  if (!imprimante) return { ok: false, erreur: 'nom d\'imprimante manquant' };

  const r = await executerPowerShell(['-Action', 'EtatFile', '-Imprimante', imprimante], 20000);
  if (!r.ok) return { ok: false, erreur: r.erreur };
  return analyserFile(r.sortie);
}

// Séparé de l'appel à PowerShell pour être vérifiable sans Windows.
function analyserFile(sortie) {
  const res = { ok: true, imprimante: null, port: null, travaux: [] };
  sortie.split(/\r?\n/).forEach((ligne) => {
    const c = ligne.split('\t').map(s => s.trim());
    if (c[0] === 'IMPRIMANTE') {
      res.imprimante = {
        nom: c[1],
        horsLigne: c[2] === 'True',
        etat: ETATS_IMPRIMANTE[+c[3]] || `code ${c[3]}`,
        erreur: ERREURS_IMPRIMANTE[+c[4]] || `code ${c[4]}`,
        portNom: c[5]
      };
    } else if (c[0] === 'PORT') {
      res.port = { type: c[1], adresse: c[2], numero: c[3] ? +c[3] : null };
    } else if (c[0] === 'TRAVAIL') {
      res.travaux.push({ id: +c[1], document: c[2], etat: c[3] || '', statut: c[4] || '' });
    }
  });
  return res;
}

/**
 * Vide la file d'attente de l'imprimante. Des travaux morts d'essais
 * précédents bloquent tous les suivants : on purge avant chaque test.
 */
async function purgerFile(imprimante) {
  if (!disponible()) return { ok: false, erreur: 'disponible uniquement sous Windows' };
  if (!imprimante) return { ok: false, erreur: 'nom d\'imprimante manquant' };
  const r = await executerPowerShell(['-Action', 'Purger', '-Imprimante', imprimante], 20000);
  return r.ok ? { ok: true } : { ok: false, erreur: r.erreur };
}

/**
 * Imprime une image PNG par le pilote, à sa taille physique exacte.
 *
 * @param {Buffer} png
 * @param {{imprimante: string, largeurPoints: number, hauteurPoints: number, ppp?: number, copies?: number, format?: string}} opt
 */
async function imprimerPng(png, opt) {
  if (!disponible()) return { ok: false, erreur: 'disponible uniquement sous Windows' };
  if (!opt || !opt.imprimante) return { ok: false, erreur: 'nom d\'imprimante manquant' };
  if (!opt.hauteurPoints) return { ok: false, erreur: 'hauteur manquante' };

  const fichier = path.join(os.tmpdir(),
    `etiquette-dlc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  fs.writeFileSync(fichier, png);

  try {
    const args = [
      '-Action', 'Imprimer',
      '-Fichier', fichier,
      '-Imprimante', opt.imprimante,
      '-LargeurPx', String(opt.largeurPoints || 696),
      '-HauteurPx', String(opt.hauteurPoints),
      '-Ppp', String(opt.ppp || 300),
      '-Copies', String(opt.copies || 1)
    ];
    if (opt.format) args.push('-Format', opt.format);
    const r = await executerPowerShell(args, 60000);

    if (!r.ok) return { ok: false, erreur: r.erreur || 'échec de l\'impression' };
    return { ok: true, detail: r.sortie };
  } finally {
    // Le fichier temporaire n'a plus d'utilité une fois le travail remis au
    // spouleur ; on ne bloque pas si Windows le tient encore ouvert.
    try { fs.unlinkSync(fichier); } catch (e) {}
  }
}

module.exports = {
  disponible, listerImprimantes, listerFormats, analyserFormats, formatPourRouleau,
  lireFile, analyserFile, purgerFile,
  imprimerPng, estEtiqueteuseBrother, enMm
};
