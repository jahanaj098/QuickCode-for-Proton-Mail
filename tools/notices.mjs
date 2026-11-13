// Build a dependency-license inventory from installed runtime packages.
import fs from 'node:fs/promises';
import path from 'node:path';
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const directories = Object.entries(lock.packages).filter(([directory, info]) => directory && !info.dev && !info.devOptional).map(([directory]) => directory);
let markdown = '# Third-party software\n\nQuickCode application code is Copyright (c) 2026 jahanaj098 and is distributed under GPL-3.0-only. Dependencies remain owned by their respective authors.\n\n| Package | Version | License | Source |\n|---|---|---|---|\n';
for (const directory of directories.sort()) {
  let pkg;
  try { pkg = JSON.parse(await fs.readFile(path.resolve(directory, 'package.json'), 'utf8')); } catch { continue; }
  const source = typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository || pkg.homepage || '';
  markdown += `| ${pkg.name} | ${pkg.version} | ${pkg.license || 'See package'} | ${source.replace(/^git\+/, '').replace(/\.git$/, '')} |\n`;
}
markdown += '\nThe original sources and license texts are distributed through npm at the exact versions recorded in package-lock.json. Browser bundles retain the libraries’ license comments in their accompanying .LEGAL.txt files.\n\nProton’s SRP implementation is consumed from the published @protontech/crypto library; QuickCode does not claim authorship of it. OpenPGP operations use the published Proton fork of OpenPGP.js. These dependencies are not copied from any other browser extension.\n';
markdown += '\nThe public SRP interoperability fixture in tests/fixtures/proton-srp.json contains test values from ProtonMail/go-srp under the MIT license, Copyright (c) 2019 Proton Technologies AG. Its license text is included at tests/fixtures/LICENSE-Proton-SRP.txt and its source URL is recorded in the fixture.\n';
await fs.writeFile('THIRD_PARTY.md', markdown);
