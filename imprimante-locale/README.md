# Serveur d'impression DLC — Brother QL-820NWBc

Imprime les étiquettes DLC **directement** sur l'imprimante, sans passer par la
boîte d'impression du navigateur.

L'impression navigateur s'est révélée inutilisable sur tablette Android : quelle
que soit la méthode, c'est toute la page de l'application qui sortait sur le
rouleau. Ce serveur contourne le problème — la tablette envoie l'étiquette déjà
tramée, le serveur l'habille du protocole raster Brother et l'expédie en TCP sur
le port 9100. Une touche = une étiquette, au bon format, à chaque fois.

## Ce qu'il vous faut

- Un ordinateur (Windows, Mac ou Linux) ou un Raspberry Pi, **allumé** et
  connecté au **même Wi-Fi que l'imprimante**
- [Node.js](https://nodejs.org) version 16 ou plus récente
- L'adresse IP de l'imprimante (menu **WLAN → TCP/IP → Adresse IP** sur son écran)

Aucune bibliothèque à installer : le serveur n'utilise que ce qui est fourni
avec Node.

## Démarrage

```bash
cd imprimante-locale
node serveur.js --imprimante 192.168.1.46
```

Le serveur affiche alors l'adresse à recopier dans l'application :

```
  Serveur d'impression DLC démarré
  ---------------------------------
  Imprimante : 192.168.1.46:9100
  À saisir dans l'application HACCP :
      http://192.168.1.20:3001

  ✓ Imprimante joignable.
```

Si vous lisez `✗ Imprimante injoignable`, vérifiez l'adresse IP et que
l'imprimante est bien sur le Wi-Fi (pas en Bluetooth : le Bluetooth ne permet
pas l'impression réseau).

### Options

| Option | Défaut | Rôle |
|---|---|---|
| `--imprimante <ip>` | `192.168.1.46` | Adresse de l'imprimante |
| `--port <n>` | `3001` | Port d'écoute du serveur |

Utilisables aussi par variables d'environnement : `QL_IMPRIMANTE`, `QL_PORT`.

## Sur la tablette

1. Ouvrez `etiquettes-dlc.html`
2. Dépliez **⚙️ Réglages**
3. Collez l'adresse affichée par le serveur dans **Adresse du serveur d'impression**
4. La pastille en haut à droite doit passer au vert : **✓ Imprimante prête**

Appuyez d'abord sur **Étiquette de test** : le trait imprimé doit mesurer
exactement 50 mm à la règle, et le trait du bas doit toucher les deux bords du
rouleau.

## Démarrage automatique

Pour que le serveur reparte tout seul après un redémarrage :

**Windows** — créez un raccourci vers `demarrer.bat` dans
`shell:startup` (touche Windows + R, puis tapez `shell:startup`).

**Mac / Linux** — ajoutez à `crontab -e` :

```
@reboot cd /chemin/vers/imprimante-locale && /usr/bin/node serveur.js --imprimante 192.168.1.46
```

## Vérification

```bash
npm test
```

Deux séries de tests, sans imprimante réelle :

- `test-raster.js` — reconstruit l'image à partir du flux produit et vérifie
  qu'elle correspond exactement à l'image de départ (centrage sur les 720 points
  de la tête, en-têtes de page, découpage multi-pages, rouleau prédécoupé)
- `test-serveur.js` — lance le serveur contre une fausse imprimante TCP et
  vérifie les octets réellement reçus, ainsi que le rejet des requêtes invalides

## Ce qui n'a pas pu être vérifié ici

Le protocole est implémenté d'après la *Raster Command Reference* de Brother pour
la série QL-800/810W/820NWB, et sa mise en forme est validée par les tests
ci-dessus. **Il n'a pas pu être essayé sur une imprimante réelle** — aucun
matériel n'était disponible.

Si la première impression sort décalée ou de travers, les valeurs à ajuster sont
dans `raster.js` :

- `MARGE_GAUCHE_62` — décalage horizontal, en points (12 par défaut)
- l'option `margePoints` de `construireFlux` — avance papier avant l'étiquette
  (35 points ≈ 3 mm)

## Interface HTTP

| Route | Méthode | Rôle |
|---|---|---|
| `/` | GET | Page d'état, affiche l'adresse à recopier |
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
