# Third-party software

QuickCode application code is Copyright (c) 2026 jahanaj098 and is distributed under GPL-3.0-only. Dependencies remain owned by their respective authors.

| Package | Version | License | Source |
|---|---|---|---|
| @noble/hashes | 2.4.0 | MIT | https://github.com/paulmillr/noble-hashes |
| @openpgp/web-stream-tools | 0.3.1 | MIT | https://github.com/openpgpjs/web-stream-tools |
| @protontech/crypto | 2.2.0 | GPL-3.0 | https://github.com/protonmail/WebPackages |
| @types/trusted-types | 2.0.7 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| bcryptjs | 3.0.3 | BSD-3-Clause | https://github.com/dcodeIO/bcrypt.js |
| comlink | 4.4.2 | Apache-2.0 | https://github.com/GoogleChromeLabs/comlink |
| core-js | 3.51.0 | MIT | https://github.com/zloirock/core-js |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) | git://github.com/cure53/DOMPurify |
| entities | 9.0.0 | BSD-2-Clause | https://github.com/fb55/entities |
| @protontech/openpgp | 6.3.1 | LGPL-3.0+ | https://github.com/ProtonMail/openpgpjs |

The original sources and license texts are distributed through npm at the exact versions recorded in package-lock.json. Browser bundles retain the libraries’ license comments in their accompanying .LEGAL.txt files.

Proton’s SRP implementation is consumed from the published @protontech/crypto library; QuickCode does not claim authorship of it. OpenPGP operations use the published Proton fork of OpenPGP.js. These dependencies are not copied from any other browser extension.

The public SRP interoperability fixture in tests/fixtures/proton-srp.json contains test values from ProtonMail/go-srp under the MIT license, Copyright (c) 2019 Proton Technologies AG. Its license text is included at tests/fixtures/LICENSE-Proton-SRP.txt and its source URL is recorded in the fixture.
