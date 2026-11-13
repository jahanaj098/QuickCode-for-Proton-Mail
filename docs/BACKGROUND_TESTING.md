# Background notification checks

`npm run test:background` loads the Chrome build in an isolated Edge profile, seeds a synthetic account, stops its worker, and waits for a real 30-second alarm to fetch synthetic OTP mail. No popup is opened and Proton API requests are intercepted.

`npm run test:background:slow` is a Windows/Edge test that launches an isolated copy of the extension using the browser debugging protocol. Only that copy receives a synthetic fetch implementation. Packaged assets remain available; Proton requests receive synthetic data. It seeds the account, closes the initial worker target, detaches its debugger, and waits for a real alarm followed by a 35-second poll. It reconnects afterward to check notification creation and the copied code target. The accelerated first alarm is for an unpacked test build only; release polling intervals are unchanged.

The isolated profiles and test extension copies are saved under ignored `artifacts/` directories. They contain synthetic credentials and messages only. Production build files are not modified by these tests. A successfully created browser notification does not certify that Windows displayed its toast or played a sound.

The 0.1.6 changes also have regression tests for a failed body read followed by an alarm-only OTP retry, rejected notification creation, and bounded progress recording during active background work. A failed body read no longer leaves an unhydrated cache entry permanently consumed for notification purposes.

If a real installation still stalls, keep the popup closed while sending fresh test mail, wait through its polling interval, then use **Preferences > Copy background diagnostics**. The report includes the last alarm, poll start/end/progress times, ready-account count and notification outcome. It excludes credentials, addresses, message content and OTP codes. A missing alarm timestamp, a running poll without completion, a body-read wait, a notification rejection and a successful creation are different failure conditions.
