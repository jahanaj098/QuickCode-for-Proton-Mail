import { describe, it, expect, vi } from 'vitest';
import { backgroundTask } from '../src/background/task';
describe('finite background poll lifetime', () => {
  it('records progress during long work, then stops immediately when it finishes', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void; const progress = vi.fn(async () => {});
      const running = backgroundTask(() => new Promise<void>(resolve => { finish = resolve; }), progress);
      await vi.advanceTimersByTimeAsync(40_000); expect(progress).toHaveBeenCalledTimes(2);
      finish(); await running; await vi.advanceTimersByTimeAsync(80_000); expect(progress).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('bounds progress recording and cleans up after failures', async () => {
    vi.useFakeTimers();
    try {
      let reject!: (error: Error) => void; const progress = vi.fn(async () => {});
      const running = backgroundTask(() => new Promise<void>((_, fail) => { reject = fail; }), progress);
      const checked = expect(running).rejects.toThrow('failed');
      await vi.advanceTimersByTimeAsync(260_000); const count = progress.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000); expect(progress).toHaveBeenCalledTimes(count);
      reject(new Error('failed')); await checked;
    } finally { vi.useRealTimers(); }
  });
});
