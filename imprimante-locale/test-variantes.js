"use strict";

// Vérifie que les cinq variantes sont bien formées et distinctes, et que la
// compression PackBits se décompresse en la ligne d'origine.

const assert = require('assert');
const net = require('net');
const { spawn } = require('child_process');

let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};

// Décompression PackBits, écrite indépendamment de l'encodeur.
function depackBits(b) {
  const sortie = [];
  let i = 0;
  while (i < b.length) {
    const n = b[i] > 127 ? b[i] - 256 : b[i];
    i++;
    if (n < 0) { for (let k = 0; k < 1 - n; k++) sortie.push(b[i]); i++; }
    else { for (let k = 0; k <= n; k++) sortie.push(b[i + k]); i += n + 1; }
  }
  return Buffer.from(sortie);
}

(async () => {
  console.log('\nVariantes de format d\'impression\n');

  // Fausse imprimante : enregistre chaque travail reçu
  const travaux = [];
  const imprimante = net.createServer(socket => {
    const m = [];
    travaux.push(m);
    socket.on('data', c => m.push(c));
    socket.on('end', () => socket.end());
  });
  await new Promise(r => imprimante.listen(9100, '127.0.0.1', r));

  await new Promise((res, rej) => {
    const p = spawn(process.execPath, [__dirname + '/outils-anciens/variantes.js', '--imprimante', '127.0.0.1'],
      { stdio: 'ignore' });
    p.on('exit', res); p.on('error', rej);
  });
  imprimante.close();

  const flux = travaux.map(m => Buffer.concat(m));

  verifier('les cinq formats ont été envoyés', () => assert.strictEqual(flux.length, 5));

  verifier('chacun commence par la purge et l\'initialisation', () => {
    flux.forEach((f, i) => {
      assert.ok(f.slice(0, 200).every(o => o === 0), `format ${i + 1} : purge absente`);
      assert.deepStrictEqual([...f.slice(200, 202)], [0x1b, 0x40], `format ${i + 1} : ESC @`);
    });
  });

  verifier('chacun se termine par l\'ordre d\'impression', () => {
    flux.forEach((f, i) => assert.strictEqual(f[f.length - 1], 0x1a, `format ${i + 1}`));
  });

  verifier('les cinq flux sont réellement différents', () => {
    const vus = new Set(flux.map(f => f.length + ':' + f.slice(200, 260).toString('hex')));
    assert.strictEqual(vus.size, 5, 'certains formats sont identiques');
  });

  verifier('le format 1 compacte les lignes vides (Z), le format 2 non', () => {
    assert.ok(flux[0].includes(0x5a), 'format 1 : aucun Z');
    assert.ok(flux[0].length < flux[1].length,
      `format 1 (${flux[0].length}) devrait être plus court que le 2 (${flux[1].length})`);
  });

  verifier('le format 3 (TIFF) est plus compact que le format 2 (brut)', () => {
    assert.ok(flux[2].length < flux[1].length,
      `TIFF ${flux[2].length} vs brut ${flux[1].length}`);
  });

  verifier('le format 4 emploie la commande w 01 et non g 00', () => {
    assert.ok(flux[3].includes(Buffer.from([0x77, 0x01, 90])), 'commande w absente');
    assert.ok(!flux[3].includes(Buffer.from([0x67, 0x00, 90])), 'commande g présente à tort');
  });

  verifier('le format 5 omet le passage en mode raster', () => {
    assert.ok(!flux[4].includes(Buffer.from([0x1b, 0x69, 0x61, 0x01])), 'ESC i a présent');
  });

  verifier('PackBits se décompresse en la ligne d\'origine', () => {
    // On extrait une ligne compressée du format 3 et on la décompresse.
    const f = flux[2];
    let i = f.indexOf(Buffer.from([0x67, 0x00]), 200);
    assert.ok(i > 0, 'aucune ligne trouvée');
    const n = f[i + 2];
    const decompressee = depackBits(f.slice(i + 3, i + 3 + n));
    assert.strictEqual(decompressee.length, 90,
      `${decompressee.length} octets après décompression au lieu de 90`);
  });

  console.log(echecs ? `\n${echecs} échec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
