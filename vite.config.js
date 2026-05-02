import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const photosDataPath = path.resolve(rootDir, 'photos.js');

function photosDataPlugin() {
  return {
    name: 'photos-data-file',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/photos.js') {
          next();
          return;
        }

        try {
          const source = await readFile(photosDataPath, 'utf8');
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.end(source);
        } catch (error) {
          next(error);
        }
      });
    },
    async buildStart() {
      const source = await readFile(photosDataPath, 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'photos.js',
        source,
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), photosDataPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        admin: path.resolve(rootDir, 'admin.html'),
        faq: path.resolve(rootDir, 'faq.html'),
      },
    },
  },
});