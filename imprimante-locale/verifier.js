"use strict";

// Vérification de l'installation, et impression d'une étiquette de test.
//
// Ne fait intervenir ni la tablette, ni le navigateur, ni le réseau : seulement
// cet ordinateur et le pilote Brother. Si l'étiquette sort ici, la chaîne
// complète fonctionnera ; si elle ne sort pas, le problème est en amont de tout
// le reste et l'outil dit lequel.

const pilote = require('./pilote-windows');
const png = require('./png');

const PPP = 300;
const mm = (n) => Math.round(n * PPP / 25.4);
const LARGEUR = 696;                     // zone imprimable d'un rouleau 62 mm
const OCTETS = LARGEUR / 8;

// Étiquette de test : un repère de 50 mm pour contrôler l'échelle, un aplat noir
// pour contrôler la densité, et deux traits pleins pour contrôler le centrage.
function imageTest() {
  const hauteur = mm(40);
  const bits = Buffer.alloc(OCTETS * hauteur);
  const poser = (x, y) => {
    if (x < 0 || x >= LARGEUR || y < 0 || y >= hauteur) return;
    bits[y * OCTETS + (x >> 3)] |= 0x80 >> (x & 7);
  };
  const rectangle = (x0, y0, l, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + l; x++) poser(x, y);
  };

  rectangle(0, mm(2), LARGEUR, mm(1.5));           // trait pleine largeur, en haut
  rectangle(mm(2), mm(7), mm(50), mm(1.5));        // repère de 50 mm
  rectangle(mm(2), mm(13), LARGEUR - mm(4), mm(12)); // aplat noir
  rectangle(0, mm(30), LARGEUR, mm(1.5));          // trait pleine largeur, en bas

  // Quatre repères d'angle, pour voir si un bord est rogné.
  [[0, mm(35)], [LARGEUR - mm(5), mm(35)]].forEach(([x, y]) => rectangle(x, y, mm(5), mm(3)));

  return { bits, largeur: LARGEUR, hauteur };
}

function lireOption(nom, defaut) {
  const i = process.argv.indexOf('--' + nom);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : defaut;
}

(async () => {
  console.log('');
  console.log('  ==================================================');
  console.log('    VERIFICATION DE L\'INSTALLATION');
  console.log('  ==================================================');
  console.log('');

  // 1. Système
  console.log(`  Systeme        : ${process.platform === 'win32' ? 'Windows' : process.platform}`);
  console.log(`  Node.js        : ${process.version}`);
  if (!pilote.disponible()) {
    console.log('');
    console.log('  Le pilote ne peut etre pilote que depuis Windows.');
    console.log('  Sur cet ordinateur, seul l\'envoi direct est possible — et il');
    console.log('  n\'imprime pas sur ce modele.');
    console.log('');
    return;
  }

  // 2. Le pilote est-il installé ?
  console.log('  Recherche des imprimantes installees dans Windows...');
  const liste = await pilote.listerImprimantes();
  console.log('');

  if (!liste.ok) {
    console.log('  IMPOSSIBLE D\'INTERROGER WINDOWS.');
    console.log(`  Detail : ${liste.erreur}`);
    console.log('');
    return;
  }

  console.log('  Imprimantes vues par Windows :');
  liste.toutes.forEach(n => {
    console.log(`    ${pilote.estEtiqueteuseBrother(n) ? '>> ' : '   '}${n}`);
  });
  console.log('');

  if (!liste.brother.length) {
    console.log('  ==================================================');
    console.log('    LE PILOTE BROTHER N\'EST PAS INSTALLE');
    console.log('  ==================================================');
    console.log('');
    console.log('  Aucune etiqueteuse Brother dans la liste ci-dessus.');
    console.log('');
    console.log('  A FAIRE :');
    console.log('   1. Clic DROIT sur l\'installateur Brother (CommonInstaller.exe)');
    console.log('      puis "Executer en tant qu\'administrateur". Il refuse');
    console.log('      d\'installer autrement.');
    console.log('   2. Modele QL-820NWBc, connexion "reseau sans fil" (Wi-Fi),');
    console.log('      adresse de l\'imprimante 192.168.1.46');
    console.log('   3. Verifiez ensuite dans Parametres > Imprimantes et');
    console.log('      scanners : la Brother doit y figurer, etat "Pret"');
    console.log('   4. Relancez cette verification');
    console.log('');
    console.log('  Si vous n\'avez pas l\'installateur : support.brother.com,');
    console.log('  modele QL-820NWBc, rubrique Telechargements.');
    console.log('');
    console.log('  Si l\'imprimante apparait sous un autre nom, relancez avec :');
    console.log('      node verifier.js --nom-imprimante "le nom exact"');
    console.log('');
    return;
  }

  const imprimante = lireOption('nom-imprimante', liste.brother[0]);
  console.log(`  Etiqueteuse retenue : ${imprimante}`);
  console.log('');

  // 3. Impression de l'étiquette de test
  console.log('  Envoi d\'une etiquette de test au pilote...');
  const img = imageTest();
  const image = png.encoder1bit(img.bits, img.largeur, img.hauteur);

  const r = await pilote.imprimerPng(image, {
    imprimante,
    largeurPoints: img.largeur,
    hauteurPoints: img.hauteur
  });

  console.log('');
  if (!r.ok) {
    console.log('  ==================================================');
    console.log('    LE PILOTE A REFUSE L\'ETIQUETTE');
    console.log('  ==================================================');
    console.log('');
    console.log(`  ${r.erreur}`);
    console.log('');
    console.log('  A verifier :');
    console.log('   - l\'imprimante est allumee et son voyant est FIXE');
    console.log('   - elle apparait comme "Pret" dans Imprimantes et scanners');
    console.log('   - un clic droit sur une photo > Imprimer fonctionne');
    console.log('     (si cela echoue aussi, le probleme est entre Windows et');
    console.log('      l\'imprimante, pas dans ce programme)');
    console.log('');
    return;
  }

  console.log('  ==================================================');
  console.log('    ETIQUETTE ENVOYEE AU PILOTE');
  console.log('  ==================================================');
  if (r.detail) console.log(`  Reponse du pilote : ${r.detail}`);
  console.log('');
  console.log('  REGARDEZ L\'IMPRIMANTE.');
  console.log('');
  console.log('  Ce qui doit sortir :');
  console.log('   - un trait noir sur toute la largeur, en haut et en bas');
  console.log('   - un trait de 50 mm exactement (mesurez a la regle)');
  console.log('   - un rectangle noir bien uniforme');
  console.log('   - deux reperes dans les coins du bas');
  console.log('');
  console.log('  Si l\'etiquette sort : tout fonctionne, la tablette peut imprimer.');
  console.log('  Si rien ne sort : le travail est parti dans la file d\'attente');
  console.log('  Windows. Ouvrez Imprimantes et scanners, cliquez sur la Brother,');
  console.log('  puis "Ouvrir la file d\'attente" pour voir ce qui bloque.');
  console.log('');
})().catch(e => {
  console.error('');
  console.error('  Erreur de la verification : ' + e.message);
  console.error('');
});
