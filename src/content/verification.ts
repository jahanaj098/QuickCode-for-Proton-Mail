// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { call } from '../core/platform';
import { captchaOrigin, captchaResult } from '../proton/verification';
// Proton's top-level CAPTCHA page posts its result to window.parent (itself).
// The background accepts results only from the exact tab and URL it opened.
if (location.origin === captchaOrigin && location.pathname === '/core/v4/captcha' && window === window.top) {
  let submitted = false;
  window.addEventListener('message', event => {
    const token = captchaResult(event, window);
    if (!token || submitted) return;
    submitted = true;
    void call<boolean>('verification-result', { token }).then(accepted => {
      if (!accepted) submitted = false;
    }).catch(() => { submitted = false; });
  });
  const heartbeat = setInterval(() => { void call('verification-ping').catch(() => {}); }, 20_000);
  window.addEventListener('pagehide', () => clearInterval(heartbeat), { once: true });
}
