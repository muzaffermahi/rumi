// The interface build. `npm run dev:web` serves it with hot reload and forwards /api to a running Rumi server
// (start one with `npm run dev`), adding the access token from <data>/server.json.
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {readJson, serverFile} from './server/paths.mjs';

export default defineConfig(() => {
  const server = readJson(serverFile, {});
  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: id => {
            if (!id.includes('node_modules')) return undefined;
            if (/@tiptap|prosemirror|lowlight|highlight\.js/.test(id)) return 'editor';
            if (/react-markdown|remark|micromark|mdast|unified|hast|vfile/.test(id)) return 'markdown';
            if (/react-dom|scheduler|\/react\//.test(id)) return 'react';
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${server.port || 4317}`,
          changeOrigin: true,
          headers: server.token ? {Authorization: `Bearer ${server.token}`} : {},
          // The dev page's own origin would be refused by the server's origin check.
          configure: proxy => proxy.on('proxyReq', req => req.removeHeader('origin')),
        },
      },
    },
    test: {environment: 'jsdom', include: ['web/**/*.test.{ts,tsx}'], setupFiles: ['web/test-setup.ts'], globals: false},
  };
});
