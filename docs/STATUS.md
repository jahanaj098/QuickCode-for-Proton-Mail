# Development status — original implementation 0.1.0

This is a newly written project, not the previous extension with its history removed. Application code and UI are new. Third-party dependencies are recorded in THIRD_PARTY.md.

## Implemented and exercised with offline or synthetic tests

- Strict TypeScript modules and separately generated Chrome/Firefox MV3 builds.
- SRP login orchestration using Proton's published library, including server-proof verification before storing a session.
- TOTP continuation and a separate mailbox-password prompt. Login passwords are cleared and not persisted by QuickCode.
- Local mailbox-key unlocking, verification of address-key tokens, body decryption, and attachment decryption.
- Remembered credentials encrypted with an AES-GCM nonextractable local device key. Browser-session credentials use storage.session. This is not a master-password vault: control of the browser profile can expose remembered sessions.
- Multiple account records, loaded-unread lists, folder selection, refresh alarms, notification deduplication across worker restarts.
- Original OTP normalization, ranking, grouping, exclusion, custom-pattern controls, quiet rules and notification redaction.
- Clipboard actions through a Chrome offscreen document; click-to-open fallback for Firefox.
- Reader, remote-image blocking, sanitized sandboxed HTML, raw text, attachment download and MIME export.
- Compose/reply/reply-all/forward UI, basic formatting, +alias validation, encrypted draft creation, encrypted attachment upload and recipient package assembly.
- Local preferences, import/export and manual browser-sync save/load.
- Original interface, three palettes, system/light/dark, density and keyboard navigation.

## Not verified against a live Proton account

- Actual login acceptance, Proton anti-abuse challenges, API client version policy and session refresh route compatibility.
- End-to-end inbox synchronization, message actions, sending, attachment upload, scheduling and expiry semantics.
- Native OS notification rendering and clipboard behavior in both installed browsers.

The tests verify local cryptographic round trips and package assembly. They do not prove Proton accepts those request payloads. Schedules/expiry are forwarded as API fields but must not be considered working until verified. Failed sends may leave an encrypted draft in Proton Mail; the UI surfaces the failure and does not silently retry a send.

## Not implemented

- Human verification/CAPTCHA and passkey/FIDO2 login.
- Legacy keys without salts, non-private managed organization keys, recovery workflows and SSO.
- Scribe, Proton Drive link sharing, calendar RSVP/ICS import, contact autocomplete and snooze.
- Attachment inline preview, sender-signature/key-transparency verification, notification sounds, custom notification click actions and undo for destructive actions.
- Draft autosave; unsent text and attachments are lost if the popup is dismissed.
- Full server-side mail search; the search filters only fetched messages. Badge counts likewise reflect the fetched unread set, capped by configured message limits.
- All behavior from the earlier derivative. This version is not feature-equivalent.

## Security review still needed

Custom regex filtering rejects some dangerous forms, but is not a full regex execution sandbox. Imported patterns are trusted local input. The cryptographic dependencies are upstream libraries; the new application/session/key-selection code has not had an independent security audit. A successful test run is not a production-readiness certification.

Firefox's local package validator currently reports zero errors and one warning: DOMPurify's bundled parser assigns input to an inert document's innerHTML as part of sanitization. The reader consumes only its sanitized output in a restricted sandbox. This warning still requires review before any store submission; it has not been suppressed.

Current local verification: 23 tests pass. The browser test also runs the real published SRP SDK against Proton's public signed-modulus test fixture and rejects an altered modulus. That is a protocol/library interoperability check, not a live login test.

## First real-account validation

1. Build and load QuickCode in a separate browser profile.
2. Connect a test Proton account through the extension UI. Do not send the password in chat, issues, or logs.
3. Check whether the account reaches TOTP/mailbox unlock, whether unread mail loads, and whether an existing message decrypts.
4. If a step fails, report only the displayed error text with personal information removed. Never share tokens, private keys, full API responses or mailbox contents.
5. Verify sending to a test recipient and downloading an attachment only after read/decryption works.

No signed release should be published until the live-account path is validated and the unresolved feature/security limits are reviewed.
