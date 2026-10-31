@echo off
rem Prysmatic Journey para o Quest: servidor HTTPS na rede local (o WebXR so funciona em HTTPS).
rem No Quest, abre no browser o endereco "Network" que aparece abaixo (https://IP-DO-PC:5443).
rem Na primeira vez o browser avisa do certificado local: Avancadas, continuar.
cd /d "%~dp0"
where npm >nul 2>nul || (echo Falta o Node.js: instala-o de https://nodejs.org & pause & exit /b 1)
if not exist node_modules\@vitejs\plugin-basic-ssl (
    echo A instalar dependencias...
    call npm install || (pause & exit /b 1)
)
call npm run quest
pause
