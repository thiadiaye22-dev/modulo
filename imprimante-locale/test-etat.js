"use strict";

// Vérifie la lecture de l'état : une fausse imprimante renvoie 32 octets
// décrivant un support donné, et l'on contrôle l'interprétation.

const net = require('net');
const assert = require('assert');
const e = require('./etat');

let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (err) { echecs++; console.log('  ✗ ' + nom + '\n      ' + err.message); }
};

function reponse({ largeur = 62, type = 0x0a, longueur = 0, err1 = 0, err2 = 0 }) {
  const o = Buffer.alloc(32, 0);
  o[0] = 0x80; o[1] = 0x20; o[2] = 0x42; o[3] = 0x30;
  o[8] = err1; o[9] = err2;
  o[10] = largeur; o[11] = type; o[17] = longueur;
  return o;
}

function serveurFactice(octets) {
  const s = net.createServer(sock => sock.on('data', () => sock.write(octets)));
  return new Promise(res => s.listen(9100, '127.0.0.1', () => res(s)));
}

(async () => {
  console.log('\nLecture de l\'etat de l\'imprimante\n');

  let srv = await serveurFactice(reponse({ largeur: 62, type: 0x0a }));
  let lu = await e.lireEtat('127.0.0.1');
  srv.close();
  verifier('rouleau continu 62 mm correctement interprété', () => {
    assert.ok(lu.ok, lu.erreur);
    assert.strictEqual(lu.etat.largeurMm, 62);
    assert.strictEqual(lu.etat.typeCle, 'continu');
    assert.strictEqual(lu.etat.longueurMm, 0);
    assert.strictEqual(lu.etat.pointsImprimables, 696);
    assert.deepStrictEqual(lu.etat.erreurs, []);
  });

  srv = await serveurFactice(reponse({ largeur: 62, type: 0x0b, longueur: 29 }));
  lu = await e.lireEtat('127.0.0.1');
  srv.close();
  verifier('étiquettes prédécoupées 62 × 29 mm reconnues', () => {
    assert.strictEqual(lu.etat.typeCle, 'predecoupe');
    assert.strictEqual(lu.etat.longueurMm, 29);
    assert.match(lu.etat.libelle, /prédécoupées 62 mm × 29 mm/);
  });

  srv = await serveurFactice(reponse({ largeur: 29, type: 0x0a }));
  lu = await e.lireEtat('127.0.0.1');
  srv.close();
  verifier('un rouleau 29 mm annonce 306 points imprimables',
    () => assert.strictEqual(lu.etat.pointsImprimables, 306));

  srv = await serveurFactice(reponse({ err2: 0x01 }));
  lu = await e.lireEtat('127.0.0.1');
  srv.close();
  verifier('l\'erreur « mauvais rouleau » est traduite', () => {
    assert.ok(lu.etat.erreurs.some(x => /ne correspond pas/.test(x)),
      JSON.stringify(lu.etat.erreurs));
  });

  srv = await serveurFactice(reponse({ err2: 0x10 }));
  lu = await e.lireEtat('127.0.0.1');
  srv.close();
  verifier('le capot ouvert est signalé',
    () => assert.ok(lu.etat.erreurs.some(x => /capot/.test(x))));

  srv = await serveurFactice(reponse({ largeur: 0, type: 0x00, err1: 0x01 }));
  lu = await e.lireEtat('127.0.0.1');
  srv.close();
  verifier('absence de rouleau détectée', () => {
    assert.strictEqual(lu.etat.typeCle, 'aucun');
    assert.ok(lu.etat.erreurs.some(x => /aucun rouleau/.test(x)));
  });

  const muet = net.createServer(() => {});
  await new Promise(res => muet.listen(9100, '127.0.0.1', res));
  lu = await e.lireEtat('127.0.0.1', 800);
  muet.close();
  verifier('une imprimante muette est signalée sans bloquer', () => {
    assert.strictEqual(lu.ok, false);
    assert.match(lu.erreur, /pas répondu/);
  });

  console.log(echecs ? `\n${echecs} échec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
