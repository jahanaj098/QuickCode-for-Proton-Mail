// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root = path.resolve(import.meta.dirname, '..');
const manifest = {
  manifest_version: 3, name: 'QuickCode for Proton Mail', short_name: 'QuickCode', version: '0.1.0',
  description: 'An original standalone Proton Mail companion with local decryption and verification-code notifications. Development version.',
  permissions: ['storage', 'alarms', 'notifications', 'clipboardWrite'], host_permissions: ['https://mail.proton.me/*'],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'" },
  icons: Object.fromEntries([16, 32, 48, 96, 128].map(size => [size, `icons/${size}.png`])),
  action: { default_title: 'QuickCode for Proton Mail', default_popup: 'ui.html', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
};
for (const browser of ['chrome', 'firefox']) {
  const directory = path.join(root, 'dist', browser);
  if (path.relative(root, directory) !== path.join('dist', browser)) throw new Error('Unexpected build destination');
  await fs.rm(directory, { recursive: true, force: true }); await fs.mkdir(path.join(directory, 'icons'), { recursive: true });
  await fs.cp(path.join(root, 'public'), directory, { recursive: true });
  const mark = await fs.readFile(path.join(root, 'public/mark.svg')); await fs.writeFile(path.join(directory, 'icons/mark.svg'), mark);
  for (const size of [16, 32, 48, 96, 128]) await sharp(mark).resize(size, size).png().toFile(path.join(directory, `icons/${size}.png`));
  const variant = structuredClone(manifest);
  if (browser === 'chrome') { variant.permissions.push('offscreen'); variant.background = { service_worker: 'background.js' }; variant.minimum_chrome_version = '121'; }
  else { variant.background = { scripts: ['background.js'] }; variant.browser_specific_settings = { gecko: { id: 'quickcode@jahanaj098', strict_min_version: '142.0', data_collection_permissions: { required: ['none'] } } }; }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(variant, null, 2));
  await build({ absWorkingDir: root, entryPoints: { background: 'src/background/main.ts', ui: 'src/ui/main.ts', clipboard: 'src/offscreen/clipboard.ts' }, outdir: directory,
    platform: 'browser', bundle: true, format: 'iife', target: ['chrome121', 'firefox142'], legalComments: 'linked', minify: false, logLevel: 'info' });
  for (const file of ['LICENSE', 'THIRD_PARTY.md', 'README.md']) try { await fs.copyFile(path.join(root, file), path.join(directory, file)); } catch { /* Files can be absent during initial development. */ }
  console.log('Built ' + directory);
}
