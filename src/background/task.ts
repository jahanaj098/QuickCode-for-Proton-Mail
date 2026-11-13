// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
// Persist progress only while a finite background operation is running. Chrome
// extension API activity also prevents idle termination in the middle of a poll.
export async function backgroundTask<T>(task: () => Promise<T>, progress: () => Promise<void>): Promise<T> {
  const timer = setInterval(() => { void progress().catch(() => {}); }, 20_000);
  const limit = setTimeout(() => clearInterval(timer), 240_000);
  try { return await task(); }
  finally { clearInterval(timer); clearTimeout(limit); }
}
