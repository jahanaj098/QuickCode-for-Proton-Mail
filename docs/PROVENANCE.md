# Original implementation record

The current standalone source was written on 13 November 2026 from a README-only checkout. See [HISTORY.md](HISTORY.md) for the owner-reported project start and the provenance of the dated milestones.

No branch, commit, source file, generated browser bundle, test, icon, or stylesheet from the earlier Mail Checker derivative checkout was imported into this repository. The application modules, UI, tests and build tooling were written as new files. The earlier checkout remains a separate project and is not an upstream remote here.

This is not a claim that every dependency was authored by jahanaj098. The published Proton crypto/SRP library, OpenPGP.js, DOMPurify and other npm dependencies retain their own copyrights and licenses. See THIRD_PARTY.md and package-lock.json. Original QuickCode application code is attributed to jahanaj098.

## Protocol references

Only public Proton material was used for API and interoperability research:

- Proton's authentication explanation: https://proton.me/blog/encrypted-email-authentication
- Proton's published cryptography package: https://github.com/ProtonMail/WebPackages
- Authentication API request descriptions: https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/api/auth.ts
- Key-salt API request descriptions: https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/api/keys.ts
- Message API request descriptions: https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/api/messages.ts
- Attachment API request descriptions: https://github.com/ProtonMail/WebClients/blob/main/packages/shared/lib/api/attachments.ts

Those API routes are internal client interfaces, not a stable third-party API contract. Compatibility and real-account verification are outstanding. Reading references and implementing compatible protocol calls does not guarantee independent legal clearance or an audited security implementation.

## Version boundary

The fresh implementation starts at 0.1.0. It is a development version, not a continuation of the earlier derivative's 2.0.7 release and not feature-equivalent. No earlier release artifact should be attached to this repository.
