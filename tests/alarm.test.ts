import { describe, it, expect, vi } from 'vitest';
const get = vi.fn(), create = vi.fn(async () => {});
vi.stubGlobal('chrome', { alarms: { get, create } });
const { ensurePollingAlarm } = await import('../src/background/polling');
describe('background polling schedule', () => {
  it('preserves an existing alarm deadline across worker restarts', async () => {
    create.mockClear(); get.mockResolvedValue({ periodInMinutes: 1, scheduledTime: Date.now() + 1000 });
    await ensurePollingAlarm(60); await ensurePollingAlarm(60); expect(create).not.toHaveBeenCalled();
  });
  it('restores a missing alarm and updates a changed interval', async () => {
    create.mockClear(); get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ periodInMinutes: 1 });
    await ensurePollingAlarm(30); await ensurePollingAlarm(30);
    expect(create).toHaveBeenCalledTimes(2); expect(create).toHaveBeenLastCalledWith('quickcode-poll', { delayInMinutes: .5, periodInMinutes: .5 });
  });
});
