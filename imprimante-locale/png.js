"use strict";

// Encodeur PNG minimal, en 1 bit par point.
//
// Le pilote Brother imprime une image ; il faut donc pouvoir en fabriquer une
// côté serveur pour l'étiquette de test, sans dépendre d'une bibliothèque.
// PNG se réduit à trois blocs et à une compression zlib, que Node fournit.

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Table CRC-32, telle que la spécification PNG la définit.
const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length, 0);
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(corps), 0);
  return Buffer.concat([longueur, corps, controle]);
}

/**
 * Encode une image 1 bit par point en PNG.
 *
 * @param {Buffer|Uint8Array} bits  lignes compactées, bit de poids fort à gauche,
 *                                  un bit à 1 signifiant un point NOIR
 * @param {number} largeur
 * @param {number} hauteur
 * @returns {Buffer}
 */
function encoder1bit(bits, largeur, hauteur) {
  const octetsParLigne = Math.ceil(largeur / 8);
  if (bits.length < octetsParLigne * hauteur) {
    throw new Error(`données insuffisantes : ${bits.length} octets pour ` +
                    `${largeur}×${hauteur} (${octetsParLigne * hauteur} attendus)`);
  }

  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 1;    // 1 bit par échantillon
  entete[9] = 0;    // niveaux de gris
  entete[10] = 0;   // compression zlib
  entete[11] = 0;   // filtrage standard
  entete[12] = 0;   // pas d'entrelacement

  // En niveaux de gris, 0 vaut noir et 1 vaut blanc : c'est l'inverse de notre
  // convention, où un bit posé désigne un point à imprimer. On inverse donc.
  const brut = Buffer.alloc((octetsParLigne + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const debut = y * (octetsParLigne + 1);
    brut[debut] = 0;                     // type de filtre : aucun
    for (let x = 0; x < octetsParLigne; x++) {
      brut[debut + 1 + x] = ~bits[y * octetsParLigne + x] & 0xff;
    }
  }

  return Buffer.concat([
    SIGNATURE,
    bloc('IHDR', entete),
    bloc('IDAT', zlib.deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { encoder1bit, crc32 };
