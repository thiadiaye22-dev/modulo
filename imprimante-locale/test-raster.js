"use strict";

// Vérification du flux raster sans imprimante : on reconstruit l'image à partir
// du flux produit et on la compare à l'image de départ. Si le décodage
// redonne exactement les mêmes points, la mise en forme du flux est cohérente.

const assert = require('assert');
const r = require('./raster');

let echecs = 0;
function verifier(nom, fn) {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
}

// Décodeur indépendant du flux, écrit à partir de la spécification.
function decoder(flux) {
  const pages = [];
  let i = 0, courante = null, entete = null;

  while (i < flux.length) {
    const o = flux[i];

    if (o === 0x00) { i++; continue; }                       // octets d'invalidation

    if (o === 0x1b) {                                        // séquences ESC
      const c = flux[i + 1], d = flux[i + 2];
      if (c === 0x40) { i += 2; continue; }                            // ESC @
      if (c === 0x69 && d === 0x61) { i += 4; continue; }              // ESC i a n
      if (c === 0x69 && d === 0x7a) {                                  // ESC i z + 10
        entete = {
          drapeaux: flux[i + 3], typeSupport: flux[i + 4],
          largeurMm: flux[i + 5], longueurMm: flux[i + 6],
          nbLignes: flux.readUInt32LE(i + 7),
          premierePage: flux[i + 11] === 0
        };
        courante = { entete, lignes: [] };
        i += 13; continue;
      }
      if (c === 0x69 && (d === 0x4d || d === 0x41 || d === 0x4b)) { i += 4; continue; }
      if (c === 0x69 && d === 0x64) {                                  // ESC i d n1 n2
        if (courante) courante.marge = flux[i + 3] | (flux[i + 4] << 8);
        i += 5; continue;
      }
      throw new Error('séquence ESC inconnue à ' + i);
    }

    if (o === 0x4d) { i += 2; continue; }                    // M n (compression)

    if (o === 0x67) {                                        // g 0x00 n data
      const n = flux[i + 2];
      courante.lignes.push(flux.slice(i + 3, i + 3 + n));
      i += 3 + n; continue;
    }

    if (o === 0x5a) { courante.lignes.push(Buffer.alloc(r.OCTETS_PAR_LIGNE, 0)); i++; continue; }

    if (o === 0x0c || o === 0x1a) {                          // fin de page
      courante.derniere = (o === 0x1a);
      pages.push(courante); courante = null; i++; continue;
    }

    throw new Error('octet inattendu 0x' + o.toString(16) + ' à ' + i);
  }
  return pages;
}

// Construit une image de test : damier + bords, en 1 bit par point.
function imageTest(largeur, hauteur) {
  const octets = Math.ceil(largeur / 8);
  const bits = Buffer.alloc(octets * hauteur, 0);
  const poser = (x, y) => { bits[y * octets + (x >> 3)] |= 0x80 >> (x & 7); };
  for (let y = 0; y < hauteur; y++) {
    poser(0, y); poser(largeur - 1, y);                       // bords gauche/droit
    for (let x = 0; x < largeur; x++) if (((x >> 3) + (y >> 3)) % 2 === 0) poser(x, y);
  }
  return bits;
}

console.log('\nProtocole raster Brother QL\n');

const LARGEUR = r.POINTS_IMPRIMABLES_62;   // 696
const HAUTEUR = 40;
const source = imageTest(LARGEUR, HAUTEUR);
const lignes = r.centrerSurTete(source, LARGEUR, HAUTEUR);

verifier('chaque ligne fait 90 octets (720 points)', () => {
  lignes.forEach(l => assert.strictEqual(l.length, r.OCTETS_PAR_LIGNE));
});

verifier('image centrée : 12 points blancs de chaque côté', () => {
  // La colonne 0 de la source est noire ; elle doit se retrouver au point 12.
  const l = lignes[0];
  const point = (buf, x) => (buf[x >> 3] & (0x80 >> (x & 7))) !== 0;
  for (let x = 0; x < r.MARGE_GAUCHE_62; x++) {
    assert.ok(!point(l, x), `point ${x} devrait être blanc`);
    assert.ok(!point(l, r.POINTS_TETE - 1 - x), `point de droite ${x} devrait être blanc`);
  }
  assert.ok(point(l, r.MARGE_GAUCHE_62), 'le bord gauche de l\'image doit être en 12');
  assert.ok(point(l, r.MARGE_GAUCHE_62 + LARGEUR - 1), 'le bord droit doit être en 707');
});

const flux = r.construireFlux([{ lignes, hauteur: HAUTEUR }], { largeurMm: 62 });

verifier('le flux commence par 200 octets nuls puis ESC @', () => {
  assert.ok(flux.slice(0, 200).every(o => o === 0), 'invalidation absente');
  assert.deepStrictEqual([...flux.slice(200, 202)], [0x1b, 0x40]);
  assert.deepStrictEqual([...flux.slice(202, 206)], [0x1b, 0x69, 0x61, 0x01]);
});

verifier('le flux se termine par l\'ordre d\'impression finale', () => {
  assert.strictEqual(flux[flux.length - 1], 0x1a);
});

const pages = decoder(flux);

verifier('le décodage retrouve une seule page', () => assert.strictEqual(pages.length, 1));

verifier('en-tête : rouleau continu 62 mm, bon nombre de lignes', () => {
  const e = pages[0].entete;
  assert.strictEqual(e.typeSupport, r.TYPE_SUPPORT.continu, 'type de support');
  assert.strictEqual(e.largeurMm, 62, 'largeur');
  assert.strictEqual(e.longueurMm, 0, 'longueur (0 sur continu)');
  assert.strictEqual(e.nbLignes, HAUTEUR, 'nombre de lignes');
  assert.ok(e.premierePage, 'première page');
});

verifier('aller-retour : les points décodés sont identiques à la source', () => {
  assert.strictEqual(pages[0].lignes.length, HAUTEUR, 'nombre de lignes décodées');
  pages[0].lignes.forEach((decodee, y) => {
    assert.ok(decodee.equals(lignes[y]), `ligne ${y} différente`);
  });
});

verifier('les lignes entièrement blanches sont compactées en un seul octet', () => {
  const blanches = r.centrerSurTete(Buffer.alloc(Math.ceil(LARGEUR / 8) * 5, 0), LARGEUR, 5);
  const f = r.construireFlux([{ lignes: blanches, hauteur: 5 }]);
  assert.strictEqual(f.filter(o => o === 0x5a).length, 5, '5 lignes Z attendues');
  assert.ok(!f.includes(0x67), 'aucun transfert g pour des lignes vides');
});

verifier('plusieurs pages : séparateur 0x0C, dernière en 0x1A', () => {
  const f = r.construireFlux([
    { lignes, hauteur: HAUTEUR }, { lignes, hauteur: HAUTEUR }, { lignes, hauteur: HAUTEUR }
  ]);
  const p = decoder(f);
  assert.strictEqual(p.length, 3, '3 pages');
  assert.ok(p[0].entete.premierePage, 'page 1 marquée première');
  assert.ok(!p[1].entete.premierePage, 'page 2 marquée suivante');
  assert.ok(!p[2].entete.premierePage, 'page 3 marquée suivante');
  assert.ok(!p[0].derniere && !p[1].derniere && p[2].derniere, 'seule la dernière termine le travail');
});

verifier('prédécoupé : longueur renseignée et marge nulle', () => {
  const f = r.construireFlux([{ lignes, hauteur: HAUTEUR }],
    { largeurMm: 62, longueurMm: 29, typeSupport: r.TYPE_SUPPORT.predecoupe });
  const p = decoder(f);
  assert.strictEqual(p[0].entete.typeSupport, r.TYPE_SUPPORT.predecoupe);
  assert.strictEqual(p[0].entete.longueurMm, 29);
  assert.strictEqual(p[0].marge, 0, 'la marge doit être nulle sur prédécoupé');
});

verifier('une ligne de mauvaise taille est refusée', () => {
  assert.throws(() => r.ligneRaster(Buffer.alloc(50)), /90/);
});

console.log(echecs ? `\n${echecs} échec(s)\n` : '\nTout est vert.\n');
process.exit(echecs ? 1 : 0);
