@echo off
chcp 65001 >nul
title Autoriser le serveur d'impression dans le pare-feu

REM Le pare-feu Windows bloque par defaut les connexions entrantes. Sans cette
REM autorisation, le serveur tourne mais reste invisible depuis la tablette.
REM Cette operation demande les droits administrateur.

net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Demande des droits administrateur...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo   ============================================================
echo     AUTORISATION DU SERVEUR D'IMPRESSION DANS LE PARE-FEU
echo   ============================================================
echo.

netsh advfirewall firewall delete rule name="Serveur impression DLC" >nul 2>nul

netsh advfirewall firewall add rule name="Serveur impression DLC" ^
  dir=in action=allow protocol=TCP localport=3001 profile=any >nul

if errorlevel 1 (
  echo   ECHEC de l'ajout de la regle.
  echo   Autorisez manuellement Node.js dans le pare-feu Windows.
) else (
  echo   OK : le port 3001 est maintenant autorise.
  echo.
  echo   La tablette devrait voir le serveur.
  echo   Relancez 2-DEMARRER-SERVEUR.bat, puis reessayez sur la tablette.
)

echo.
pause
