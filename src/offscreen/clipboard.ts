// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.clipboard !== true || typeof message.code !== 'string' || message.code.length > 32) return false;
  navigator.clipboard.writeText(message.code).then(() => respond({ copied: true })).catch(() => respond({ copied: false }));
  return true;
});
