@echo off
REM Lance le serveur d'impression DLC. Modifiez l'adresse ci-dessous si
REM l'imprimante change d'IP (menu WLAN > TCP/IP > Adresse IP sur son ecran).
set IMPRIMANTE=192.168.1.46
cd /d "%~dp0"
node serveur.js --imprimante %IMPRIMANTE%
pause
