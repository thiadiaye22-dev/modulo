@echo off
chcp 65001 >nul
title Essai des formats d'impression
cd /d "%~dp0"
node variantes.js %*
echo.
pause
