import { defineConfig } from 'vite';
import { chatPlugin } from './server/chat-plugin';

export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2022' },
  plugins: [chatPlugin()],
});
