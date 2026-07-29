@echo off
chcp 65001 >nul
title Sonde de communication avec l'imprimante
cd /d "%~dp0"
node sonde.js %*
echo.
pause
