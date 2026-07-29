"use strict";

// Vérifie l'encodeur PNG : les blocs, les dimensions, la somme de contrôle, et
// surtout que l'image se décode en les points de départ. Le décodage est écrit
// indépendamment de l'encodeur, à partir de la spécification.

const assert = require('assert');
const zlib = require('zlib');
const png = require('./png');

let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};

// Décodeur indépendant, limité au strict nécessaire.
function decoder(buf) {
  assert.deepStrictEqual([...buf.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'signature PNG absente');
  let i = 8;
  const blocs = {};
  const morceauxIdat = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString('ascii');
    const donnees = buf.slice(i + 8, i + 8 + n);
    const controle = buf.readUInt32BE(i + 8 + n);
    assert.strictEqual(png.crc32(Buffer.concat([Buffer.from(type, 'ascii'), donnees])), controle,
      `somme de contrôle invalide sur ${type}`);
    if (type === 'IDAT') morceauxIdat.push(donnees); else blocs[type] = donnees;
    i += 12 + n;
  }
  const e = blocs.IHDR;
  const largeur = e.readUInt32BE(0), hauteur = e.readUInt32BE(4);
  const brut = zlib.inflateSync(Buffer.concat(morceauxIdat));
  const octetsParLigne = Math.ceil(largeur / 8);
  const bits = Buffer.alloc(octetsParLigne * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const debut = y * (octetsParLigne + 1);
    assert.strictEqual(brut[debut], 0, `filtre inattendu ligne ${y}`);
    for (let x = 0; x < octetsParLigne; x++) {
      bits[y * octetsParLigne + x] = ~brut[debut + 1 + x] & 0xff;
    }
  }
  return { largeur, hauteur, profondeur: e[8], typeCouleur: e[9], bits, blocs };
}

console.log('\nEncodeur PNG 1 bit\n');

const LARGEUR = 696, HAUTEUR = 40;
const octets = Math.ceil(LARGEUR / 8);
const source = Buffer.alloc(octets * HAUTEUR);
// Motif reconnaissable : bords verticaux, damier, une ligne pleine.
for (let y = 0; y < HAUTEUR; y++) {
  const poser = (x) => { source[y * octets + (x >> 3)] |= 0x80 >> (x & 7); };
  poser(0); poser(LARGEUR - 1);
  if (y === 20) for (let x = 0; x < LARGEUR; x++) poser(x);
  for (let x = 0; x < LARGEUR; x++) if (((x >> 4) + (y >> 3)) % 2 === 0) poser(x);
}

const image = png.encoder1bit(source, LARGEUR, HAUTEUR);
const d = decoder(image);

verifier('les dimensions sont conservées', () => {
  assert.strictEqual(d.largeur, LARGEUR);
  assert.strictEqual(d.hauteur, HAUTEUR);
});

verifier('l\'image est bien en 1 bit, niveaux de gris', () => {
  assert.strictEqual(d.profondeur, 1, 'profondeur');
  assert.strictEqual(d.typeCouleur, 0, 'type de couleur');
});

verifier('les trois blocs obligatoires sont présents', () => {
  assert.ok(d.blocs.IHDR, 'IHDR');
  assert.ok(d.blocs.IEND, 'IEND');
  assert.strictEqual(d.blocs.IEND.length, 0, 'IEND doit être vide');
});

verifier('aller-retour : les points décodés sont identiques à la source', () => {
  assert.ok(d.bits.equals(source), 'les points diffèrent après décodage');
});

// En niveaux de gris, la valeur 0 vaut noir. Un bit posé dans notre convention
// doit donc ressortir à 0 dans les données du PNG, sans quoi l'étiquette
// sortirait en négatif.
verifier('un point posé ressort en NOIR dans les données du PNG', () => {
  const unPoint = Buffer.from([0x80]);          // un seul point, en haut à gauche
  const petit = png.encoder1bit(unPoint, 8, 1);

  // On extrait IDAT sans passer par le décodeur, pour lire la valeur stockée.
  let i = 8, idat = null;
  while (i < petit.length) {
    const n = petit.readUInt32BE(i);
    if (petit.slice(i + 4, i + 8).toString('ascii') === 'IDAT') {
      idat = petit.slice(i + 8, i + 8 + n);
      break;
    }
    i += 12 + n;
  }
  assert.ok(idat, 'bloc IDAT introuvable');

  const brut = zlib.inflateSync(idat);
  assert.strictEqual(brut[0], 0, 'octet de filtre');
  // Point de gauche noir (bit 7 à 0), les sept autres blancs (bits à 1).
  assert.strictEqual(brut[1], 0x7f,
    `octet 0x${brut[1].toString(16)} au lieu de 0x7f : l'image sortirait en négatif`);
});

verifier('une image trop courte est refusée', () => {
  assert.throws(() => png.encoder1bit(Buffer.alloc(10), 696, 40), /données insuffisantes/);
});

verifier('la compression réduit réellement la taille', () => {
  assert.ok(image.length < octets * HAUTEUR,
    `PNG ${image.length} octets pour ${octets * HAUTEUR} octets bruts`);
});

console.log(echecs ? `\n${echecs} échec(s)\n` : '\nTout est vert.\n');
process.exit(echecs ? 1 : 0);
