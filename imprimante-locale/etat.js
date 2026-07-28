"use strict";

// Lecture de l'état d'une imprimante Brother QL.
//
// La commande ESC i S provoque le renvoi de 32 octets décrivant le support
// chargé et les erreurs en cours. Interroger l'imprimante évite de lui déclarer
// un rouleau différent de celui qui est réellement en place — ce qu'elle refuse
// avec « mauvais type de rouleau ».

const net = require('net');

const PORT_IMPRIMANTE = 9100;

const TYPE_SUPPORT = {
  0x00: { cle: 'aucun',      libelle: 'aucun rouleau' },
  0x0a: { cle: 'continu',    libelle: 'rouleau continu' },
  0x0b: { cle: 'predecoupe', libelle: 'étiquettes prédécoupées' },
  0x4a: { cle: 'continu',    libelle: 'rouleau continu' },
  0x4b: { cle: 'predecoupe', libelle: 'étiquettes prédécoupées' }
};

// Points imprimables par largeur de support, à 300 ppp.
const POINTS_IMPRIMABLES = {
  12: 106, 29: 306, 38: 413, 50: 554, 54: 590, 62: 696, 102: 1164
};

// Octet 8 — première série d'erreurs.
const ERREURS_1 = [
  [0x01, "aucun rouleau n'est chargé"],
  [0x02, 'fin du rouleau atteinte'],
  [0x04, 'bourrage au niveau du massicot'],
  [0x10, "l'imprimante est occupée"],
  [0x20, "l'imprimante est éteinte"],
  [0x40, "problème d'alimentation électrique"],
  [0x80, 'défaut du ventilateur']
];

// Octet 9 — seconde série d'erreurs.
const ERREURS_2 = [
  [0x01, 'le rouleau chargé ne correspond pas à celui demandé'],
  [0x02, 'mémoire de l\'imprimante saturée'],
  [0x04, 'erreur de communication'],
  [0x08, 'tampon de communication plein'],
  [0x10, 'le capot est ouvert'],
  [0x20, 'impression annulée depuis l\'imprimante'],
  [0x40, "le rouleau ne peut pas avancer"],
  [0x80, 'erreur système de l\'imprimante']
];

function analyser(octets) {
  if (!octets || octets.length < 32) return null;
  if (octets[0] !== 0x80 || octets[2] !== 0x42) return null;   // pas une réponse Brother

  const largeurMm = octets[10];
  const codeType = octets[11];
  const longueurMm = octets[17];
  const type = TYPE_SUPPORT[codeType] || { cle: 'inconnu', libelle: 'support inconnu' };

  const erreurs = [];
  ERREURS_1.forEach(([bit, texte]) => { if (octets[8] & bit) erreurs.push(texte); });
  ERREURS_2.forEach(([bit, texte]) => { if (octets[9] & bit) erreurs.push(texte); });

  return {
    largeurMm,
    longueurMm,                       // 0 sur rouleau continu
    typeSupport: codeType,
    typeCle: type.cle,
    pointsImprimables: POINTS_IMPRIMABLES[largeurMm] || null,
    erreurs,
    libelle: type.cle === 'aucun'
      ? 'aucun rouleau chargé'
      : `${type.libelle} ${largeurMm} mm` + (longueurMm ? ` × ${longueurMm} mm` : ''),
    brut: Array.from(octets.slice(0, 32))
  };
}

/**
 * Interroge l'imprimante et renvoie l'état du support chargé.
 * @returns {Promise<{ok: boolean, etat?: object, erreur?: string}>}
 */
function lireEtat(ip, delai) {
  return new Promise(resoudre => {
    const socket = new net.Socket();
    const morceaux = [];
    let fini = false;
    const terminer = (resultat) => {
      if (fini) return;
      fini = true;
      socket.destroy();
      resoudre(resultat);
    };

    socket.setTimeout(delai || 4000);
    socket.on('timeout', () => terminer({ ok: false, erreur: "l'imprimante n'a pas répondu à temps" }));
    socket.on('error', (e) => terminer({ ok: false, erreur: e.message }));
    socket.on('data', (c) => {
      morceaux.push(c);
      const recu = Buffer.concat(morceaux);
      if (recu.length >= 32) {
        const etat = analyser(recu);
        terminer(etat ? { ok: true, etat }
                      : { ok: false, erreur: 'réponse non reconnue' });
      }
    });

    socket.connect(PORT_IMPRIMANTE, ip, () => {
      socket.write(Buffer.concat([
        Buffer.alloc(200, 0x00),            // purge d'un travail incomplet
        Buffer.from([0x1b, 0x40]),          // ESC @  — initialisation
        Buffer.from([0x1b, 0x69, 0x53])     // ESC i S — demande d'état
      ]));
    });
  });
}

module.exports = { lireEtat, analyser, POINTS_IMPRIMABLES, PORT_IMPRIMANTE };
