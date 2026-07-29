"use strict";

// Sonde de communication avec l'imprimante.
//
// L'imprimante accepte les connexions mais ne répond à aucune commande, et
// n'imprime rien. Avant de corriger le contenu envoyé, il faut établir si le
// canal fonctionne. Cet outil essaie plusieurs façons de lui parler et rapporte
// exactement ce qui revient, sans rien interpréter.

const net = require('net');

const PORTS = [
  { port: 9100, nom: 'impression brute (raw / JetDirect)' },
  { port: 631,  nom: 'IPP' },
  { port: 515,  nom: 'LPD / LPR' },
  { port: 80,   nom: 'interface web' },
  { port: 54921, nom: 'port propriétaire Brother' }
];

const hex = (b) => Array.from(b).map(o => o.toString(16).padStart(2, '0')).join(' ');

function testerPort(ip, port, delai) {
  return new Promise(resoudre => {
    const s = new net.Socket();
    let fini = false;
    const fin = (ouvert, detail) => {
      if (fini) return;
      fini = true;
      s.destroy();
      resoudre({ port, ouvert, detail });
    };
    s.setTimeout(delai || 1500);
    s.on('timeout', () => fin(false, 'pas de réponse'));
    s.on('error', (e) => fin(false, e.code || e.message));
    s.connect(port, ip, () => fin(true, 'connexion acceptée'));
  });
}

/**
 * Envoie une séquence sur le port 9100 et rapporte tout ce qui revient
 * pendant la durée d'écoute, sans rien interpréter.
 */
function essai(ip, nom, sequence, attente) {
  return new Promise(resoudre => {
    const s = new net.Socket();
    const recu = [];
    let fini = false;
    const fin = (note) => {
      if (fini) return;
      fini = true;
      s.destroy();
      const b = Buffer.concat(recu);
      resoudre({ nom, octets: b.length, hex: b.length ? hex(b.slice(0, 40)) : null, note });
    };

    s.setTimeout((attente || 6000) + 2000);
    s.on('timeout', () => fin('délai dépassé'));
    s.on('error', (e) => fin('erreur : ' + (e.code || e.message)));
    s.on('data', (c) => recu.push(c));
    s.on('close', () => fin('connexion fermée par l\'imprimante'));

    s.connect(9100, ip, () => {
      if (sequence.length) {
        s.write(sequence);
        // On termine le flux proprement : couper brutalement ferait perdre à
        // l'imprimante ce qu'elle n'a pas encore lu.
        s.end();
      }
      setTimeout(() => fin(recu.length ? 'réponse reçue' : 'aucune réponse'), attente || 6000);
    });
  });
}

function lireOption(nom, defaut) {
  const i = process.argv.indexOf('--' + nom);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : defaut;
}

(async () => {
  const ip = lireOption('imprimante', '192.168.1.46');

  console.log('');
  console.log('  =========================================');
  console.log('    SONDE DE COMMUNICATION');
  console.log(`    Imprimante : ${ip}`);
  console.log('  =========================================');
  console.log('');
  console.log('  Cela prend environ une minute. Patientez.');
  console.log('');

  console.log('  --- Ports ouverts ---');
  for (const p of PORTS) {
    const r = await testerPort(ip, p.port);
    console.log(`   ${r.ouvert ? 'OUVERT ' : 'ferme  '} ${String(p.port).padEnd(6)} ${p.nom}` +
                (r.ouvert ? '' : `  (${r.detail})`));
  }
  console.log('');

  // Différentes façons de demander l'état : si l'une répond, on saura laquelle.
  const ESC = 0x1b;
  const essais = [
    ['demande d\'etat seule',
      Buffer.from([ESC, 0x69, 0x53])],
    ['initialisation puis demande d\'etat',
      Buffer.concat([Buffer.from([ESC, 0x40]), Buffer.from([ESC, 0x69, 0x53])])],
    ['purge + initialisation + demande d\'etat',
      Buffer.concat([Buffer.alloc(200, 0), Buffer.from([ESC, 0x40]), Buffer.from([ESC, 0x69, 0x53])])],
    ['mode raster puis demande d\'etat',
      Buffer.concat([Buffer.alloc(200, 0), Buffer.from([ESC, 0x40]),
                     Buffer.from([ESC, 0x69, 0x61, 0x01]), Buffer.from([ESC, 0x69, 0x53])])],
    ['ecoute seule, sans rien envoyer',
      Buffer.alloc(0)]
  ];

  console.log('  --- Reponses de l\'imprimante ---');
  for (const [nom, seq] of essais) {
    const r = await essai(ip, nom, seq, 5000);
    console.log(`   ${nom}`);
    console.log(`      ${r.octets} octet(s) recu(s) — ${r.note}`);
    if (r.hex) console.log(`      ${r.hex}`);
  }
  console.log('');

  // Avance papier : la commande la plus simple qui produise un effet visible.
  console.log('  --- Test d\'avance papier ---');
  console.log('   Une commande minimale est envoyee : le rouleau devrait avancer.');
  const avance = Buffer.concat([
    Buffer.alloc(200, 0),
    Buffer.from([ESC, 0x40]),        // initialisation
    Buffer.from([0x0c])              // fin de page : avance et coupe
  ]);
  const r = await essai(ip, 'avance papier', avance, 4000);
  console.log(`      ${r.octets} octet(s) recu(s) — ${r.note}`);
  console.log('');
  console.log('   REGARDEZ L\'IMPRIMANTE : le rouleau a-t-il avance ?');
  console.log('   - OUI  : le canal fonctionne, le probleme est dans le contenu');
  console.log('   - NON  : l\'imprimante ignore ce qu\'on lui envoie sur ce port');
  console.log('');
})().catch(e => console.error('  Erreur de la sonde : ' + e.message));
