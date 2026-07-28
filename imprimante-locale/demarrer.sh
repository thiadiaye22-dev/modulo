#!/bin/sh
# Lance le serveur d'impression DLC. Modifiez l'adresse ci-dessous si
# l'imprimante change d'IP (menu WLAN > TCP/IP > Adresse IP sur son écran).
IMPRIMANTE=192.168.1.46
cd "$(dirname "$0")"
exec node serveur.js --imprimante "$IMPRIMANTE"
