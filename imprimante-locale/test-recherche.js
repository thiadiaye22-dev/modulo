"use strict";

// Vérifie la recherche automatique : une fausse imprimante est ouverte sur
// 127.0.0.1:9100 et l'on contrôle qu'elle est détectée, et qu'une adresse
// sans rien derrière ne l'est pas.

const net = require('net');
const assert = require('assert');
const r = require('./recherche');

let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};

(async () => {
  console.log('\nRecherche automatique de l\'imprimante\n');

  const faux = net.createServer(() => {});
  await new Promise(res => faux.listen(9100, '127.0.0.1', res));

  const trouve = await r.testerAdresse('127.0.0.1', 1000);
  verifier('une adresse qui écoute sur 9100 est détectée',
    () => assert.strictEqual(trouve, '127.0.0.1'));

  faux.close();
  await new Promise(res => setTimeout(res, 200));

  const absent = await r.testerAdresse('127.0.0.1', 500);
  verifier('une adresse sans imprimante n\'est pas retenue',
    () => assert.strictEqual(absent, null));

  const injoignable = await r.testerAdresse('192.0.2.1', 400);   // réseau de test, RFC 5737
  verifier('une adresse injoignable rend la main dans le délai',
    () => assert.strictEqual(injoignable, null));

  verifier('les réseaux locaux sont listés avec leur base /24', () => {
    const reseaux = r.reseauxLocaux();
    reseaux.forEach(x => {
      assert.match(x.base, /^\d+\.\d+\.\d+$/, 'base ' + x.base);
      assert.ok(x.adresse.startsWith(x.base + '.'), 'adresse hors de sa base');
    });
  });

  console.log(echecs ? `\n${echecs} échec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
