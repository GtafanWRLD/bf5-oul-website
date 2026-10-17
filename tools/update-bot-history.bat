@echo off
rem Drag the bot's data\store.json onto this file to refresh bot-history.js for Player lookup.
cd /d "%~dp0.."
if "%~1"=="" (
  node tools\build-bot-history.mjs
) else (
  node tools\build-bot-history.mjs "%~1"
)
pause
