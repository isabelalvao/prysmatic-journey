@echo off
rem Silent Orbit no browser: instala as dependências na primeira vez e abre http://localhost:5180
cd /d "%~dp0"
where npm >nul 2>nul || (echo Falta o Node.js: instala-o de https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
    echo A instalar dependencias...
    call npm install || (pause & exit /b 1)
)
call npx vite --open
