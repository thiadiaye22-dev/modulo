"use strict";

// Construction du flux raster Brother pour les imprimantes d'étiquettes
// QL-800 / QL-810W / QL-820NWB(c), d'après la « Raster Command Reference » Brother.
//
// L'imprimante écoute en TCP sur le port 9100 et attend un flux d'octets :
// initialisation, description du support, lignes de points, ordre d'impression.
// Aucune dépendance externe.

// La tête d'impression compte 720 points. Sur un rouleau de 62 mm, seuls 696
// points sont imprimables, centrés : 12 points de marge de chaque côté.
const POINTS_TETE = 720;
const OCTETS_PAR_LIGNE = POINTS_TETE / 8;      // 90
const POINTS_IMPRIMABLES_62 = 696;
const MARGE_GAUCHE_62 = (POINTS_TETE - POINTS_IMPRIMABLES_62) / 2;   // 12

const TYPE_SUPPORT = { continu: 0x0a, predecoupe: 0x0b };

function u32le(n) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

// --- Étapes du protocole ---

// 200 octets nuls : purge un éventuel travail incomplet resté dans le tampon.
const invalider = () => Buffer.alloc(200, 0x00);

const initialiser = () => Buffer.from([0x1b, 0x40]);                    // ESC @

const modeRaster = () => Buffer.from([0x1b, 0x69, 0x61, 0x01]);         // ESC i a 1

// ESC i z — description du support et nombre de lignes de la page.
function informationsImpression(opt) {
  const drapeaux =
    0x02 |   // type de support renseigné
    0x04 |   // largeur du support renseignée
    0x08 |   // longueur du support renseignée
    0x40 |   // priorité à la qualité d'impression
    0x80;    // récupération automatique après erreur
  return Buffer.concat([
    Buffer.from([0x1b, 0x69, 0x7a, drapeaux,
      opt.typeSupport,
      opt.largeurMm,
      opt.longueurMm,               // 0 sur rouleau continu
    ]),
    u32le(opt.nbLignes),
    Buffer.from([opt.premierePage ? 0x00 : 0x01, 0x00])
  ]);
}

// ESC i M — bit 6 : coupe automatique.
const modeDivers = (coupeAuto) => Buffer.from([0x1b, 0x69, 0x4d, coupeAuto ? 0x40 : 0x00]);

// ESC i A — couper toutes les n pages.
const pagesParCoupe = (n) => Buffer.from([0x1b, 0x69, 0x41, n & 0xff]);

// ESC i K — bit 3 : couper en fin de travail ; bit 6 : haute résolution 600 dpi.
function modeEtendu(couperALaFin, hauteResolution) {
  let n = 0;
  if (couperALaFin) n |= 0x08;
  if (hauteResolution) n |= 0x40;
  return Buffer.from([0x1b, 0x69, 0x4b, n]);
}

// ESC i d — marge d'avance papier, en points.
const marge = (points) => Buffer.from([0x1b, 0x69, 0x64, points & 0xff, (points >> 8) & 0xff]);

// M — mode de compression. 0 = aucun (on envoie les lignes telles quelles).
const compression = () => Buffer.from([0x4d, 0x00]);

// g — transfert d'une ligne de points. Z — ligne entièrement blanche.
function ligneRaster(octets) {
  if (octets.length !== OCTETS_PAR_LIGNE) {
    throw new Error(`ligne raster de ${octets.length} octets, attendu ${OCTETS_PAR_LIGNE}`);
  }
  if (octets.every(o => o === 0x00)) return Buffer.from([0x5a]);   // ligne vide compactée
  return Buffer.concat([Buffer.from([0x67, 0x00, OCTETS_PAR_LIGNE]), octets]);
}

const IMPRIMER_PAGE = Buffer.from([0x0c]);        // fin de page, la suivante suit
const IMPRIMER_DERNIERE = Buffer.from([0x1a]);    // fin du travail, avance et coupe

/**
 * Assemble le flux complet à envoyer à l'imprimante.
 *
 * @param {Array<{lignes: Buffer[], hauteur: number}>} pages
 *        une entrée par étiquette ; chaque ligne fait 90 octets (720 points).
 * @param {object} [opt]
 * @returns {Buffer}
 */
function construireFlux(pages, opt) {
  opt = opt || {};
  const largeurMm = opt.largeurMm || 62;
  const longueurMm = opt.longueurMm || 0;
  const typeSupport = opt.typeSupport || (longueurMm ? TYPE_SUPPORT.predecoupe : TYPE_SUPPORT.continu);
  const coupeAuto = opt.coupeAuto !== false;
  const margePoints = opt.margePoints != null ? opt.margePoints : 35;   // ~3 mm à 300 dpi

  if (!pages.length) throw new Error('aucune page à imprimer');

  const morceaux = [invalider(), initialiser(), modeRaster()];

  pages.forEach((page, i) => {
    const derniere = i === pages.length - 1;
    morceaux.push(informationsImpression({
      typeSupport, largeurMm, longueurMm,
      nbLignes: page.lignes.length,
      premierePage: i === 0
    }));
    morceaux.push(modeDivers(coupeAuto));
    morceaux.push(pagesParCoupe(1));
    morceaux.push(modeEtendu(coupeAuto, false));
    // Sur rouleau continu la marge est portée par la page ; sur prédécoupé
    // elle est imposée par l'étiquette et doit rester nulle.
    morceaux.push(marge(typeSupport === TYPE_SUPPORT.continu ? margePoints : 0));
    morceaux.push(compression());
    page.lignes.forEach(l => morceaux.push(ligneRaster(l)));
    morceaux.push(derniere ? IMPRIMER_DERNIERE : IMPRIMER_PAGE);
  });

  return Buffer.concat(morceaux);
}

/**
 * Place une image 1 bit par point dans des lignes de 90 octets, centrée sur la tête.
 *
 * @param {Buffer} bits    lignes déjà compactées à `largeurPoints` bits, MSB à gauche
 * @param {number} largeurPoints
 * @param {number} hauteur
 * @returns {Buffer[]}
 */
function centrerSurTete(bits, largeurPoints, hauteur) {
  const octetsSource = Math.ceil(largeurPoints / 8);
  const decalage = largeurPoints === POINTS_IMPRIMABLES_62
    ? MARGE_GAUCHE_62
    : Math.max(0, Math.floor((POINTS_TETE - largeurPoints) / 2));

  const lignes = [];
  for (let y = 0; y < hauteur; y++) {
    const sortie = Buffer.alloc(OCTETS_PAR_LIGNE, 0x00);
    for (let x = 0; x < largeurPoints; x++) {
      const octet = bits[y * octetsSource + (x >> 3)];
      if (octet & (0x80 >> (x & 7))) {
        const xd = x + decalage;
        sortie[xd >> 3] |= 0x80 >> (xd & 7);
      }
    }
    lignes.push(sortie);
  }
  return lignes;
}

module.exports = {
  construireFlux, centrerSurTete, ligneRaster,
  POINTS_TETE, OCTETS_PAR_LIGNE, POINTS_IMPRIMABLES_62, MARGE_GAUCHE_62, TYPE_SUPPORT
};
