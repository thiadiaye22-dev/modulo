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

  // 3. L'état de la file d'attente : c'est là que « rien ne sort » se joue.
  // Une réponse « OK » du pilote dit seulement que le travail est entré dans
  // la file ; si Windows tient l'imprimante pour hors connexion, il y restera.
  const avant = await pilote.lireFile(imprimante);
  if (avant.ok && avant.port) {
    if (avant.port.type === 'TCPIP') {
      console.log(`  Port Windows      : reseau, adresse ${avant.port.adresse}` +
                  (avant.port.numero ? `:${avant.port.numero}` : ''));
    } else {
      console.log(`  Port Windows      : ${avant.port.adresse}`);
      if (/^WSD/i.test(avant.port.adresse)) {
        console.log('                      (port "WSD" : ce type de port tombe');
        console.log('                      souvent hors connexion tout seul)');
      }
    }
  }
  if (avant.ok && avant.imprimante) {
    console.log(`  Etat selon Windows: ${avant.imprimante.etat}` +
                (avant.imprimante.erreur !== 'aucune' ? ` — erreur : ${avant.imprimante.erreur}` : ''));

    if (avant.imprimante.horsLigne) {
      console.log('');
      console.log('  ==================================================');
      console.log('    WINDOWS TIENT L\'IMPRIMANTE POUR "HORS CONNEXION"');
      console.log('  ==================================================');
      console.log('');
      console.log('  Voila pourquoi rien ne sort : le pilote accepte les');
      console.log('  etiquettes, mais Windows les garde dans la file d\'attente');
      console.log('  au lieu de les envoyer.');
      console.log('');
      console.log('  A FAIRE :');
      console.log('   1. Parametres > Bluetooth et appareils > Imprimantes et');
      console.log('      scanners > Brother QL-820NWB');
      console.log('   2. "Ouvrir la file d\'attente d\'impression"');
      console.log('   3. Dans la petite fenetre, menu "Imprimante" (en haut) :');
      console.log('      DECOCHEZ "Utiliser l\'imprimante hors connexion"');
      console.log('   4. Relancez cette verification');
      console.log('');
      console.log('  Si la case se recoche toute seule, Windows n\'arrive plus a');
      console.log('  joindre l\'imprimante par le port indique ci-dessus :');
      console.log('  eteignez l\'imprimante, rallumez-la, attendez le voyant fixe,');
      console.log('  et relancez cette verification.');
      console.log('');
      return;
    }

    if (avant.travaux.length) {
      console.log(`  File d'attente    : ${avant.travaux.length} travail(aux) ` +
                  'coince(s) d\'essais precedents — on vide la file...');
      const purge = await pilote.purgerFile(imprimante);
      if (!purge.ok) console.log(`                      purge impossible : ${purge.erreur}`);
    }
  }

  // 4. Ce que le pilote déclare savoir faire
  const format = lireOption('format', '');
  const reglages = await pilote.listerFormats(imprimante);
  if (!reglages.ok) {
    console.log(`  Formats du pilote : lecture impossible (${reglages.erreur})`);
  } else {
    if (reglages.defaut) {
      const d = reglages.defaut;
      console.log(`  Format par defaut : ${d.nom} — ` +
                  `${pilote.enMm(d.largeur)} x ${pilote.enMm(d.hauteur)} mm`);
    }
    if (reglages.zone) {
      const z = reglages.zone;
      console.log(`  Zone imprimable   : ${pilote.enMm(z.largeur)} x ` +
                  `${pilote.enMm(z.hauteur)} mm, a partir de ` +
                  `${pilote.enMm(z.x)} / ${pilote.enMm(z.y)} mm`);
    }
    if (reglages.resolutions.length) {
      console.log('  Resolutions       : ' +
        reglages.resolutions.map(r => `${r.x}x${r.y}`).join(', ') + ' ppp');
    }
    if (reglages.formats.length) {
      console.log('');
      console.log(`  Formats declares par le pilote (${reglages.formats.length}) :`);
      reglages.formats.forEach(f => {
        console.log(`    ${pilote.enMm(f.largeur).toString().padStart(6)} x ` +
                    `${pilote.enMm(f.hauteur).toString().padEnd(6)} mm   ${f.nom}`);
      });
    }
  }
  console.log('');

  // 5. Impression de l'étiquette de test
  console.log('  Envoi d\'une etiquette de test au pilote...');
  if (format) console.log(`  Format impose : ${format}`);
  const img = imageTest();
  const image = png.encoder1bit(img.bits, img.largeur, img.hauteur);

  const r = await pilote.imprimerPng(image, {
    imprimante,
    largeurPoints: img.largeur,
    hauteurPoints: img.hauteur,
    format: format || undefined
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
  if (r.detail) r.detail.split(/\r?\n/).forEach(l => console.log(`  ${l}`));
  console.log('');

  // 6. Le travail est-il vraiment parti, ou coincé dans la file ?
  console.log('  On laisse 8 secondes a Windows, puis on regarde la file...');
  await new Promise(res => setTimeout(res, 8000));
  const apres = await pilote.lireFile(imprimante);
  console.log('');
  if (apres.ok) {
    if (!apres.travaux.length) {
      console.log('  La file d\'attente est VIDE : Windows a bien remis le');
      console.log('  travail a l\'imprimante.');
    } else {
      console.log('  LE TRAVAIL EST ENCORE DANS LA FILE D\'ATTENTE :');
      apres.travaux.forEach(t => {
        console.log(`    - "${t.document}" — etat : ${t.etat || t.statut || 'en attente'}`);
      });
      console.log('');
      console.log('  Tant qu\'il y reste, rien ne sortira. Le plus souvent :');
      console.log('   - l\'imprimante n\'est plus joignable par le port Windows');
      console.log('     (eteignez-la, rallumez-la, attendez le voyant fixe)');
      console.log('   - ou le rouleau ne correspond pas au format regle dans le');
      console.log('     pilote (le voyant de l\'imprimante clignote alors)');
      console.log('');
      console.log('  Relancez ensuite cette verification : elle videra la file');
      console.log('  et refera un essai propre.');
      console.log('');
      return;
    }
  }
  console.log('');
  console.log('  REGARDEZ L\'IMPRIMANTE.');
  console.log('');
  console.log('  Ce qui doit sortir, sur environ 40 mm de long :');
  console.log('   - un trait noir sur toute la largeur, en haut et en bas');
  console.log('   - un trait de 50 mm exactement (mesurez a la regle)');
  console.log('   - un rectangle noir bien uniforme');
  console.log('   - deux reperes dans les coins du bas');
  console.log('');
  console.log('  ETIQUETTE CONFORME  ->  tout fonctionne. Lancez ensuite');
  console.log('                          2-DEMARRER-SERVEUR.bat');
  console.log('');
  console.log('  RIEN NE SORT        ->  le travail attend dans la file Windows.');
  console.log('                          Parametres > Imprimantes et scanners >');
  console.log('                          la Brother > "Ouvrir la file d\'attente" :');
  console.log('                          l\'etat du travail dit ce qui bloque.');
  console.log('');
  console.log('  DU PAPIER BLANC SORT ->  l\'image part au mauvais endroit ou le');
  console.log('                          format ne correspond pas. Notez la ligne');
  console.log('                          "PAGE:" ci-dessus et la longueur sortie.');
  console.log('');
  console.log('  MAUVAISE TAILLE     ->  relancez en imposant un format du pilote,');
  console.log('                          choisi dans la liste ci-dessus :');
  console.log('                          node verifier.js --format "62mm"');
  console.log('');
})().catch(e => {
  console.error('');
  console.error('  Erreur de la verification : ' + e.message);
  console.error('');
});
