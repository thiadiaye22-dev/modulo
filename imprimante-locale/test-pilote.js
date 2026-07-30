"use strict";

// Vérifie la sélection de méthode et la voie « pilote » sans Windows.
//
// Le module pilote-windows n'est utilisable que sous Windows ; on contrôle donc
// qu'il refuse proprement ailleurs, que la reconnaissance des étiqueteuses
// Brother par leur nom est juste, et que le serveur retombe sur l'envoi direct
// plutôt que de rester bloqué.

const assert = require('assert');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const pilote = require('./pilote-windows');

const PORT_HTTP = 3990;
let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};
const attendre = (ms) => new Promise(r => setTimeout(r, ms));

function requete(chemin, corps) {
  return new Promise((resoudre, rejeter) => {
    const d = corps ? Buffer.from(JSON.stringify(corps)) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT_HTTP, path: chemin,
      method: corps ? 'POST' : 'GET',
      headers: d ? { 'Content-Type': 'application/json', 'Content-Length': d.length } : {} },
      (rep) => {
        const m = [];
        rep.on('data', c => m.push(c));
        rep.on('end', () => {
          const t = Buffer.concat(m).toString();
          try { resoudre({ code: rep.statusCode, corps: JSON.parse(t) }); }
          catch (e) { resoudre({ code: rep.statusCode, corps: t }); }
        });
      });
    req.on('error', rejeter);
    if (d) req.write(d);
    req.end();
  });
}

(async () => {
  console.log('\nImpression par le pilote Brother\n');

  verifier('les etiqueteuses Brother sont reconnues a leur nom', () => {
    const ouiKo = [
      ['Brother QL-820NWBc', true],
      ['Brother QL-800', true],
      ['QL-1110NWB', true],
      ['Brother QL-820NWBc (Copie 1)', true],
      ['Brother DCP-L2530DW', false],     // imprimante bureautique
      ['Microsoft Print to PDF', false],
      ['OneNote (Desktop)', false],
      ['HP LaserJet', false]
    ];
    ouiKo.forEach(([nom, attendu]) => {
      assert.strictEqual(pilote.estEtiqueteuseBrother(nom), attendu, nom);
    });
  });

  verifier('le module se declare indisponible hors Windows', () => {
    assert.strictEqual(pilote.disponible(), process.platform === 'win32');
  });

  if (!pilote.disponible()) {
    const liste = await pilote.listerImprimantes();
    verifier('lister refuse proprement hors Windows', () => {
      assert.strictEqual(liste.ok, false);
      assert.match(liste.erreur, /Windows/);
    });

    const imp = await pilote.imprimerPng(Buffer.alloc(10), {
      imprimante: 'X', largeurPoints: 696, hauteurPoints: 100 });
    verifier('imprimer refuse proprement hors Windows', () => {
      assert.strictEqual(imp.ok, false);
      assert.match(imp.erreur, /Windows/);
    });
  }

  verifier('les tailles du pilote se convertissent en millimetres', () => {
    assert.strictEqual(pilote.enMm(100), 25.4);   // un pouce
    assert.strictEqual(pilote.enMm(244), 62);     // largeur du rouleau DK-22205
    assert.strictEqual(pilote.enMm(0), 0);
  });

  verifier('la sortie du pilote se relit en formats, zone et resolutions', () => {
    const brut = [
      'DEFAUT\t62mm\t244\t3937\tCustom',
      'ZONE\t5\t0\t236\t3937',
      'FORMAT\t29mm x 90mm\t114\t354\tCustom',
      'FORMAT\t62mm\t244\t3937\tCustom',
      'RESOLUTION\tHigh\t300\t600',
      'RESOLUTION\tMedium\t300\t300',
      ''                                    // ligne vide de fin, à ignorer
    ].join('\r\n');
    const r = pilote.analyserFormats(brut);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.defaut.nom, '62mm');
    assert.strictEqual(pilote.enMm(r.defaut.largeur), 62);
    assert.deepStrictEqual(r.zone, { x: 5, y: 0, largeur: 236, hauteur: 3937 });
    assert.strictEqual(r.formats.length, 2);
    assert.strictEqual(r.formats[0].nom, '29mm x 90mm');
    assert.strictEqual(r.resolutions.length, 2);
    assert.strictEqual(r.resolutions[0].x, 300);
    assert.strictEqual(r.resolutions[0].y, 600);
  });

  verifier('une sortie vide ne fait pas echouer la lecture', () => {
    const r = pilote.analyserFormats('');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.defaut, null);
    assert.deepStrictEqual(r.formats, []);
  });

  verifier('l\'etat de la file se relit : hors connexion, port, travaux', () => {
    const brut = [
      'IMPRIMANTE\tBrother QL-820NWB\tTrue\t3\t2\tWSD-70a3...',
      'PORT\tAUTRE\tWSD-70a3...\t',
      'TRAVAIL\t7\tEtiquette DLC\tError - Printing\tImpression'
    ].join('\r\n');
    const r = pilote.analyserFile(brut);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.imprimante.horsLigne, true);
    assert.strictEqual(r.imprimante.etat, 'prête');       // code 3
    assert.strictEqual(r.imprimante.erreur, 'aucune');    // code 2
    assert.strictEqual(r.port.type, 'AUTRE');
    assert.match(r.port.adresse, /^WSD/);
    assert.strictEqual(r.travaux.length, 1);
    assert.strictEqual(r.travaux[0].id, 7);
    assert.strictEqual(r.travaux[0].document, 'Etiquette DLC');
    assert.match(r.travaux[0].etat, /Error/);
  });

  verifier('une imprimante en ligne au port reseau, file vide', () => {
    const brut = [
      'IMPRIMANTE\tBrother QL-820NWB\tFalse\t3\t2\t192.168.1.46_1',
      'PORT\tTCPIP\t192.168.1.46\t9100'
    ].join('\r\n');
    const r = pilote.analyserFile(brut);
    assert.strictEqual(r.imprimante.horsLigne, false);
    assert.deepStrictEqual(r.port, { type: 'TCPIP', adresse: '192.168.1.46', numero: 9100 });
    assert.deepStrictEqual(r.travaux, []);
  });

  if (!pilote.disponible()) {
    const fileKo = await pilote.lireFile('X');
    const purgeKo = await pilote.purgerFile('X');
    verifier('file et purge refusent proprement hors Windows', () => {
      assert.strictEqual(fileKo.ok, false);
      assert.match(fileKo.erreur, /Windows/);
      assert.strictEqual(purgeKo.ok, false);
      assert.match(purgeKo.erreur, /Windows/);
    });
  }

  const sansNom = await pilote.imprimerPng(Buffer.alloc(10), { hauteurPoints: 10 });
  verifier('un appel sans nom d\'imprimante est refuse', () => {
    assert.strictEqual(sansNom.ok, false);
    assert.ok(sansNom.erreur, 'aucune raison donnée');
  });

  // Le serveur doit retomber sur l'envoi direct hors Windows, sans se bloquer.
  const imprimante = net.createServer(socket => {
    socket.on('data', c => {
      if (c.length < 300) {
        const e = Buffer.alloc(32, 0);
        e[0] = 0x80; e[1] = 0x20; e[2] = 0x42; e[10] = 62; e[11] = 0x0a;
        socket.write(e);
      }
    });
  });
  await new Promise(r => imprimante.listen(9100, '127.0.0.1', r));
  const serveur = spawn(process.execPath, [__dirname + '/serveur.js',
    '--imprimante', '127.0.0.1', '--port', String(PORT_HTTP)], { stdio: 'ignore' });
  await attendre(3000);

  try {
    const etat = await requete('/etat');
    verifier('le serveur demarre et annonce sa methode', () => {
      assert.strictEqual(etat.code, 200);
      assert.strictEqual(etat.corps.methode, 'direct',
        `methode ${etat.corps.methode} au lieu de direct hors Windows`);
    });

    // En méthode pilote, une page sans PNG doit être refusée avec un message clair.
    const serveurPilote = spawn(process.execPath, [__dirname + '/serveur.js',
      '--imprimante', '127.0.0.1', '--port', String(PORT_HTTP + 1),
      '--methode', 'pilote', '--nom-imprimante', 'Brother QL-820NWBc'], { stdio: 'ignore' });
    await attendre(3000);
    const sansPng = await new Promise((res, rej) => {
      const d = Buffer.from(JSON.stringify({ pages: [{ largeurPoints: 696, hauteur: 100 }] }));
      const req = http.request({ host: '127.0.0.1', port: PORT_HTTP + 1, path: '/imprimer',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } },
        (rep) => {
          const m = [];
          rep.on('data', c => m.push(c));
          rep.on('end', () => res({ code: rep.statusCode, corps: JSON.parse(Buffer.concat(m).toString()) }));
        });
      req.on('error', rej);
      req.write(d); req.end();
    });
    serveurPilote.kill();
    verifier('en methode pilote, une page sans image PNG est refusee clairement', () => {
      assert.strictEqual(sansPng.code, 400);
      assert.match(sansPng.corps.erreur, /PNG absente/);
      assert.match(sansPng.corps.erreur, /Rechargez/);
    });

  } finally {
    serveur.kill();
    imprimante.close();
  }

  console.log(echecs ? `\n${echecs} echec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
