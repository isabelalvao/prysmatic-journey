import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Modo «quest» (npm run quest / Iniciar-VR.cmd): HTTPS com certificado local e aberto à rede, porque o browser do
// Quest só deixa entrar em WebXR em HTTPS. O browser avisa do certificado na primeira vez: «Avançadas» → continuar.
export default defineConfig(({ mode }) => {
  const quest = mode === 'quest';
  return {
    base: './',
    plugins: quest ? [basicSsl({ name: 'prysmatic-journey' })] : [],
    server: quest ? { host: true, port: 5443 } : { host: 'localhost', port: 5180 },
    preview: quest ? { host: true, port: 5443 } : { host: 'localhost', port: 5181 },
    build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  };
});
