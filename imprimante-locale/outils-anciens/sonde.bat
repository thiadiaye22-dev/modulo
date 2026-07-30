@echo off
chcp 65001 >nul
title ANCIEN OUTIL - ne sert plus
cd /d "%~dp0.."

echo.
echo   ==============================================================
echo     CET OUTIL NE SERT PLUS A RIEN
echo   ==============================================================
echo.
echo   La sonde teste l'ANCIENNE methode : l'envoi direct sur le
echo   port 9100. Cette methode n'imprime pas sur la QL-820NWBc.
echo.
echo   Son resultat sera toujours identique, quoi qu'on fasse :
echo     - les ports sont ouverts
echo     - "0 octet recu" a chaque demande d'etat
echo     - le papier avance un peu, rien ne s'imprime
echo.
echo   Le relancer n'apporte aucune information nouvelle.
echo.
echo   ==============================================================
echo     LE FICHIER A LANCER, C'EST :
echo.
echo       1-VERIFIER-IMPRIMANTE.bat
echo.
echo     Il se trouve dans le dossier juste AU-DESSUS de celui-ci.
echo   ==============================================================
echo.
echo   Fermez cette fenetre, remontez d'un dossier, et double-cliquez
echo   sur 1-VERIFIER-IMPRIMANTE.bat
echo.
echo   (Pour executer la sonde malgre tout : node outils-anciens\sonde.js)
echo.
pause
exit /b 0
