import { defineConfig } from 'vite';
import { chatPlugin } from './server/chat-plugin';

// 웹 배포(GitHub Pages): LASER_BASE=/laser-tool/ VITE_WEB=1 vite build
export default defineConfig({
  base: process.env.LASER_BASE || '/',
  server: { port: 5173 },
  build: { target: 'es2022' },
  plugins: [chatPlugin()],
});
