@echo off
rem Gera a versão estática em dist\ (para copiar para qualquer servidor HTTPS) e pré-visualiza em http://localhost:5181
cd /d "%~dp0"
if not exist node_modules call npm install || (pause & exit /b 1)
call npx vite build || (pause & exit /b 1)
call npx vite preview --open
