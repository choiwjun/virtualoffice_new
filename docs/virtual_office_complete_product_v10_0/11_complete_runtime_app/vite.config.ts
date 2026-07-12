import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function servePackageFiles(): Plugin {
  return {
    name: 'serve-virtual-office-package-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const prefixes = ['/01_runtime_3d/', '/02_ui_overlay_assets/', '/03_scene_prefabs/', '/05_registries/', '/12_layout_presets/'];
        if (!prefixes.some((prefix) => url.startsWith(prefix))) return next();
        const file = path.resolve(packageRoot, `.${url}`);
        if (!file.startsWith(packageRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        const ext = path.extname(file).toLowerCase();
        const mime: Record<string, string> = {
          '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
          '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.csv': 'text/csv',
        };
        res.statusCode = 200;
        res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [servePackageFiles()],
  server: { fs: { allow: [packageRoot] } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
