import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: [{ find: /^openpgp\/lightweight$/, replacement: fileURLToPath(new URL('./node_modules/openpgp/dist/node/openpgp.mjs', import.meta.url)) }] }, test: { server: { deps: { inline: true } } } });
