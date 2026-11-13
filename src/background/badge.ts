// Copyright (c) 2026 jahanaj098. SPDX-License-Identifier: GPL-3.0-only
export function badgeCount(accounts: string[], selected: string, counts: Record<string, number | null>): string {
  const scoped = selected ? accounts.filter(id => id === selected) : accounts;
  if (!scoped.length) return '';
  if (scoped.some(id => !Number.isSafeInteger(counts[id]) || counts[id] === null || counts[id]! < 0)) return '?';
  const total = scoped.reduce((sum, id) => sum + counts[id]!, 0);
  return total ? String(total) : '';
}
