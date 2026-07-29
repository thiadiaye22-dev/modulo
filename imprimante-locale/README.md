# Serveur d'impression DLC — Brother QL-820NWBc

Imprime les étiquettes DLC **directement** sur l'imprimante, sans passer par la
boîte d'impression du navigateur.

L'impression navigateur s'est révélée inutilisable sur tablette Android : quelle
que soit la méthode, c'est toute la page de l'application qui sortait sur le
rouleau. Ce serveur contourne le problème — la tablette lui envoie l'étiquette,
il la fait imprimer, et le navigateur n'intervient plus. Une touche = une
étiquette, au bon format.

## Deux méthodes d'impression

**Pilote Brother** (par défaut sous Windows quand une étiqueteuse Brother y est
installée). L'étiquette est remise au pilote, qui produit l'encodage attendu par
l'imprimante. C'est la voie fiable.

**Envoi direct** (repli). Le serveur construit lui-même le protocole raster
Brother et l'expédie en TCP sur le port 9100. Cette voie **n'a jamais réussi à
imprimer sur la QL-820NWBc** malgré plusieurs corrections : l'imprimante accepte
les commandes, avance le papier, mais n'imprime pas les points. L'encodage exact
qu'elle attend n'a pas pu être identifié à distance. Le code et ses outils de
diagnostic sont conservés, mais ne comptez pas sur cette voie.

## Ce qu'il vous faut

- Un ordinateur **Windows**, **allumé**, sur le même réseau que l'imprimante
- [Node.js](https://nodejs.org) version 16 ou plus récente
- Le **pilote Brother** de la QL-820NWBc installé, et l'imprimante ajoutée dans
  *Paramètres > Imprimantes et scanners*. Téléchargement sur
  [support.brother.com](https://support.brother.com).

Mac et Linux fonctionnent aussi, mais seulement en envoi direct — donc sans
garantie d'impression.

Aucune bibliothèque à installer : le serveur n'utilise que ce qui est fourni
avec Node, et PowerShell pour dialoguer avec le pilote.

## Démarrage

**Windows** — double-cliquez sur `demarrer.bat`.
**Mac / Linux** — double-cliquez sur `demarrer.sh`, ou lancez `node serveur.js`.

Pas d'adresse IP à saisir : le serveur cherche l'imprimante tout seul sur le
réseau, puis affiche en clair l'adresse à recopier sur la tablette.

```
  ===========================================
    SERVEUR D'IMPRESSION DES ETIQUETTES DLC
  ===========================================

  Recherche de l'imprimante sur le reseau, patientez...

    Recherche sur le réseau 192.168.1.x …

  Imprimante trouvee : 192.168.1.46

  A RECOPIER DANS L'APPLICATION, SUR LA TABLETTE :

  +--------------------------+
  |  http://192.168.1.20:3001  |
  +--------------------------+
```

Si vous lisez `AUCUNE IMPRIMANTE TROUVEE`, c'est que l'imprimante est éteinte,
n'est pas en Wi-Fi (le Bluetooth ne permet pas l'impression réseau), ou que
l'ordinateur n'est pas sur le même réseau qu'elle.

**Laissez la fenêtre ouverte** : la fermer arrête le serveur.

### Options

| Option | Défaut | Rôle |
|---|---|---|
| `--methode <pilote\|direct>` | `pilote` si possible | Impose la méthode d'impression |
| `--nom-imprimante "<nom>"` | première Brother trouvée | Imprimante Windows à utiliser |
| `--imprimante <ip>` | recherche automatique | Adresse de l'imprimante, pour l'envoi direct |
| `--port <n>` | `3001` | Port d'écoute du serveur |

Utilisables aussi par variables d'environnement : `QL_IMPRIMANTE`, `QL_PORT`.
L'adresse fournie est d'abord testée ; si elle ne répond pas, la recherche
automatique prend le relais.

## Sur la tablette

**Ouvrez simplement l'adresse affichée par le serveur** dans le navigateur —
par exemple `http://192.168.1.18:3001`. L'application s'affiche directement.

Rien à copier sur la tablette, rien à saisir : l'application est servie par le
serveur d'impression, donc elle connaît déjà son adresse.

Ce point n'est pas qu'une commodité. Ouverte depuis un fichier local, la page
ne peut pas joindre le serveur : Chrome bloque les requêtes d'une page locale
vers une adresse du réseau privé. Servie par le serveur, la page et les
requêtes partagent la même origine et plus rien n'est bloqué.

Astuce : dans le menu de Chrome, **Ajouter à l'écran d'accueil** — la page se
retrouve comme une vraie application.

Appuyez d'abord sur **Étiquette de test** : le trait imprimé doit mesurer
exactement 50 mm à la règle, et le trait du bas doit toucher les deux bords du
rouleau.

### Si la tablette affiche « Serveur injoignable »

- **Le pare-feu Windows** bloque les connexions entrantes. Lancez
  `autoriser-pare-feu.bat` en clic droit → *Exécuter en tant qu'administrateur*.
- **La tablette n'est pas sur le même réseau** que l'ordinateur : ni 4G, ni
  réseau « invité », que beaucoup de box isolent du réseau principal.

## Démarrage automatique

Pour que le serveur reparte tout seul après un redémarrage :

**Windows** — créez un raccourci vers `demarrer.bat` dans
`shell:startup` (touche Windows + R, puis tapez `shell:startup`).

**Mac / Linux** — ajoutez à `crontab -e` :

```
@reboot cd /chemin/vers/imprimante-locale && /usr/bin/node serveur.js
```

## Vérification

```bash
npm test
```

Sept séries de tests, sans imprimante réelle :

- `test-raster.js` — reconstruit l'image à partir du flux produit et vérifie
  qu'elle correspond exactement à l'image de départ (centrage sur les 720 points
  de la tête, en-têtes de page, découpage multi-pages, rouleau prédécoupé)
- `test-recherche.js` — détection d'une imprimante sur le réseau, et absence de
  faux positif sur une adresse sans rien derrière
- `test-serveur.js` — lance le serveur contre une fausse imprimante TCP et
  vérifie les octets réellement reçus, ainsi que le rejet des requêtes invalides
- `test-envoi.js` — envoie un travail réaliste à une imprimante qui lit
  lentement, et vérifie qu'aucun octet ne manque
- `test-variantes.js` — les cinq formats raster sont bien formés et distincts
- `test-pilote.js` — reconnaissance des étiqueteuses Brother par leur nom, refus
  propre hors Windows, et repli du serveur sur l'envoi direct

## Outils de diagnostic

Tous se lancent d'un double-clic sous Windows :

| Fichier | Rôle |
|---|---|
| `diagnostic.bat` | Interroge l'imprimante : rouleau, erreurs, octets bruts |
| `sonde.bat` | Ports ouverts, réponses aux commandes, test d'avance papier |
| `variantes.bat` | Essaie cinq formats de données raster, un par un |

## Ce qui n'a pas pu être vérifié ici

Aucune imprimante n'était disponible pendant le développement. Les tests
s'appuient sur des imprimantes factices : ils garantissent la forme des données,
pas le comportement du matériel.

Ce que le terrain a établi sur la QL-820NWBc, en envoi direct :

- elle accepte les connexions sur le port 9100 et lit ce qu'on lui envoie ;
- elle **ne répond à aucune demande d'état** (`ESC i S`), contrairement à ce que
  documente Brother pour cette série ;
- une commande d'avance papier **fonctionne** : le rouleau avance ;
- aucun des cinq formats raster essayés n'imprime de points.

Le canal est donc bon et les commandes sont exécutées ; c'est l'encodage des
lignes de points qui reste inconnu. D'où le choix de passer par le pilote.

Si l'étiquette sort décalée en envoi direct, les valeurs à ajuster sont dans
`raster.js` : `MARGE_GAUCHE_62` (décalage horizontal, 12 points) et l'option
`margePoints` de `construireFlux` (avance papier, 35 points ≈ 3 mm).

## Interface HTTP

| Route | Méthode | Rôle |
|---|---|---|
| `/` | GET | Sert l'application d'étiquettes |
| `/etat.html` | GET | Page d'état lisible |
| `/etat` | GET | `{ joignable, detail }` — teste la connexion à l'imprimante |
| `/imprimer` | POST | Envoie un travail d'impression |

Corps attendu par `/imprimer` :

```json
{
  "pages": [
    { "bits": "<base64>", "largeurPoints": 696, "hauteur": 871 }
  ],
  "options": { "largeurMm": 62 },
  "simulation": false
}
```

`bits` contient l'image à 1 bit par point, ligne par ligne, le bit de poids fort
correspondant au point le plus à gauche. Avec `"simulation": true`, le flux est
construit et mesuré mais rien n'est envoyé à l'imprimante — pratique pour tester.
