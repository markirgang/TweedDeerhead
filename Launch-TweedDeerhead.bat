@echo off
title TweedDeerhead - 121 Tweed Blvd, Nyack, NY 10960
cd /d "%~dp0"
echo Starting TweedDeerhead Server on http://localhost:3121 ...
start "" "http://localhost:3121"
node server.js
pause
