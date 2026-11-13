// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
import { extension } from '../core/platform';
export async function ensurePollingAlarm(seconds: number): Promise<void> {
  const periodInMinutes = seconds / 60;
  const current = await extension.alarms.get('quickcode-poll');
  // Recreating a repeating alarm postpones its next run. Preserve its deadline.
  if (!current || current.periodInMinutes !== periodInMinutes) {
    await extension.alarms.create('quickcode-poll', { delayInMinutes: periodInMinutes, periodInMinutes });
  }
}
