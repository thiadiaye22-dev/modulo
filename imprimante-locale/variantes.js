"use strict";

// Essai de plusieurs formats de données raster.
//
// Le canal est confirmé : une commande d'avance papier fait bien avancer le
// rouleau. L'imprimante accepte donc nos commandes, mais n'imprime pas les
// points. La façon exacte de transmettre une ligne varie d'un modèle à l'autre
// et n'est pas devinable — on envoie donc cinq variantes, et celle qui sort
// désigne le format attendu par cette imprimante.
//
// Chaque variante imprime un nombre de barres noires égal à son numéro :
// la variante 1 imprime une barre, la 2 en imprime deux, et ainsi de suite.
// Il suffit de compter les barres sur ce qui sort du rouleau.

const net = require('net');

const PORT_IMPRIMANTE = 9100;
const POINTS_TETE = 720;
const OCTETS_PAR_LIGNE = 90;
const MARGE_GAUCHE = 12;
const LARGEUR_IMAGE = 696;
const PPP = 300;
const mm = (n) => Math.round(n * PPP / 25.4);

function lireOption(nom, defaut) {
  const i = process.argv.indexOf('--' + nom);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : defaut;
}

// --- Image : n barres noires horizontales, sur toute la largeur utile ---
function imageBarres(n) {
  const hBarre = mm(5), hBlanc = mm(4);
  const hauteur = n * hBarre + (n + 1) * hBlanc;
  const lignes = [];
  for (let y = 0; y < hauteur; y++) {
    const ligne = Buffer.alloc(OCTETS_PAR_LIGNE, 0x00);
    const dansUneBarre = (() => {
      let p = hBlanc;
      for (let i = 0; i < n; i++) {
        if (y >= p && y < p + hBarre) return true;
        p += hBarre + hBlanc;
      }
      return false;
    })();
    if (dansUneBarre) {
      for (let x = MARGE_GAUCHE; x < MARGE_GAUCHE + LARGEUR_IMAGE; x++) {
        ligne[x >> 3] |= 0x80 >> (x & 7);
      }
    }
    lignes.push(ligne);
  }
  return lignes;
}

// --- Compression PackBits, telle que Brother l'attend en mode TIFF ---
function packBits(ligne) {
  const sortie = [];
  let i = 0;
  while (i < ligne.length) {
    let j = i;
    while (j + 1 < ligne.length && ligne[j + 1] === ligne[i]) j++;
    const repetitions = j - i + 1;
    if (repetitions >= 2) {
      sortie.push(257 - repetitions, ligne[i]);       // suite identique
      i = j + 1;
    } else {
      let k = i;
      while (k + 1 < ligne.length && ligne[k + 1] !== ligne[k] && k - i < 127) k++;
      const litteraux = k - i + (k + 1 < ligne.length ? 1 : 1);
      sortie.push(litteraux - 1);
      for (let m = 0; m < litteraux; m++) sortie.push(ligne[i + m]);
      i += litteraux;
    }
  }
  return Buffer.from(sortie);
}

const u32le = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);

const INVALIDER = Buffer.alloc(200, 0x00);
const INIT = Buffer.from([0x1b, 0x40]);
const MODE_RASTER = Buffer.from([0x1b, 0x69, 0x61, 0x01]);
const IMPRIMER = Buffer.from([0x1a]);

function infosPage(nbLignes) {
  return Buffer.concat([
    Buffer.from([0x1b, 0x69, 0x7a, 0x02 | 0x04 | 0x40 | 0x80, 0x0a, 62, 0]),
    u32le(nbLignes),
    Buffer.from([0x00, 0x00])
  ]);
}

const REGLAGES = Buffer.concat([
  Buffer.from([0x1b, 0x69, 0x4d, 0x40]),   // coupe automatique
  Buffer.from([0x1b, 0x69, 0x41, 0x01]),   // couper chaque page
  Buffer.from([0x1b, 0x69, 0x4b, 0x08]),   // couper en fin de travail
  Buffer.from([0x1b, 0x69, 0x64, 35, 0])   // marge d'avance
]);

// --- Les cinq variantes ---
const VARIANTES = [
  {
    n: 1,
    nom: 'format actuel (g 00, sans compression, lignes vides compactees)',
    construire: (lignes) => Buffer.concat([
      INVALIDER, INIT, MODE_RASTER, infosPage(lignes.length), REGLAGES,
      Buffer.from([0x4d, 0x00]),
      ...lignes.map(l => l.every(o => o === 0)
        ? Buffer.from([0x5a])
        : Buffer.concat([Buffer.from([0x67, 0x00, OCTETS_PAR_LIGNE]), l])),
      IMPRIMER
    ])
  },
  {
    n: 2,
    nom: 'sans compactage des lignes vides (toutes en g 00)',
    construire: (lignes) => Buffer.concat([
      INVALIDER, INIT, MODE_RASTER, infosPage(lignes.length), REGLAGES,
      Buffer.from([0x4d, 0x00]),
      ...lignes.map(l => Buffer.concat([Buffer.from([0x67, 0x00, OCTETS_PAR_LIGNE]), l])),
      IMPRIMER
    ])
  },
  {
    n: 3,
    nom: 'compression TIFF (M 02) au lieu de brut',
    construire: (lignes) => Buffer.concat([
      INVALIDER, INIT, MODE_RASTER, infosPage(lignes.length), REGLAGES,
      Buffer.from([0x4d, 0x02]),
      ...lignes.map(l => {
        const c = packBits(l);
        return Buffer.concat([Buffer.from([0x67, 0x00, c.length]), c]);
      }),
      IMPRIMER
    ])
  },
  {
    n: 4,
    nom: 'commande w 01 (plan noir des modeles bicolores)',
    construire: (lignes) => Buffer.concat([
      INVALIDER, INIT, MODE_RASTER, infosPage(lignes.length), REGLAGES,
      Buffer.from([0x4d, 0x00]),
      ...lignes.map(l => Buffer.concat([Buffer.from([0x77, 0x01, OCTETS_PAR_LIGNE]), l])),
      IMPRIMER
    ])
  },
  {
    n: 5,
    nom: 'minimal : ni reglages de coupe, ni mode raster',
    construire: (lignes) => Buffer.concat([
      INVALIDER, INIT, infosPage(lignes.length),
      Buffer.from([0x4d, 0x00]),
      ...lignes.map(l => Buffer.concat([Buffer.from([0x67, 0x00, OCTETS_PAR_LIGNE]), l])),
      IMPRIMER
    ])
  }
];

function envoyer(ip, flux) {
  return new Promise(resoudre => {
    const s = new net.Socket();
    let fini = false;
    const fin = (note) => { if (fini) return; fini = true; s.destroy(); resoudre(note); };
    s.setTimeout(20000);
    s.on('timeout', () => fin('delai depasse'));
    s.on('error', (e) => fin('erreur : ' + (e.code || e.message)));
    s.on('close', () => fin('envoye'));
    s.connect(PORT_IMPRIMANTE, ip, () => {
      s.write(flux);
      s.end();
      setTimeout(() => fin('envoye'), 6000);
    });
  });
}

const pause = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const ip = lireOption('imprimante', '192.168.1.46');

  console.log('');
  console.log('  ==============================================');
  console.log('    ESSAI DE PLUSIEURS FORMATS D\'IMPRESSION');
  console.log(`    Imprimante : ${ip}`);
  console.log('  ==============================================');
  console.log('');
  console.log('  Cinq formats vont etre envoyes, l\'un apres l\'autre.');
  console.log('  Chacun imprime AUTANT DE BARRES NOIRES que son numero :');
  console.log('    format 1 -> 1 barre     format 4 -> 4 barres');
  console.log('    format 2 -> 2 barres    format 5 -> 5 barres');
  console.log('    format 3 -> 3 barres');
  console.log('');
  console.log('  SURVEILLEZ LE ROULEAU et notez les groupes de barres qui sortent.');
  console.log('  Comptez les barres de chaque groupe : leur nombre donne le');
  console.log('  format que votre imprimante comprend.');
  console.log('');
  console.log('  Debut dans 5 secondes...');
  console.log('');
  await pause(5000);

  for (const v of VARIANTES) {
    const lignes = imageBarres(v.n);
    const flux = v.construire(lignes);
    process.stdout.write(`  Format ${v.n} — ${v.nom}\n`);
    process.stdout.write(`     ${flux.length} octets, ${lignes.length} lignes ... `);
    const note = await envoyer(ip, flux);
    console.log(note);
    await pause(4000);
  }

  console.log('');
  console.log('  ==============================================');
  console.log('  TERMINE.');
  console.log('');
  console.log('  Combien de groupes de barres sont sortis, et combien de');
  console.log('  barres dans chacun ? C\'est la reponse qu\'il me faut.');
  console.log('  Si RIEN n\'est sorti, dites-le : cela exclut ces cinq formats.');
  console.log('  ==============================================');
  console.log('');
})().catch(e => console.error('  Erreur : ' + e.message));
