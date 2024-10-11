import { describe, it, expect, vi } from 'vitest';
import { ProtonTransport } from '../src/proton/api';
import type { Credential } from '../src/core/model';
const session = (): Credential => ({ id: 'id', uid: 'uid', username: 'me', access: 'expired', refresh: 'refresh', remember: false, label: 'Me', color: '#177668', phase: 'ready' });
describe('Proton request boundary', () => {
  it('rotates a session once when concurrent requests expire, omits web cookies', async () => {
    let rotations = 0; const credential = session(); const saved = vi.fn(async () => {});
    const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      expect(options?.credentials).toBe('omit');
      if (String(url).includes('/auth/v4/refresh')) { rotations++; await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ Code: 1000, AccessToken: 'fresh', RefreshToken: 'rotated' }); }
      if ((options?.headers as Record<string, string>).Authorization === 'Bearer expired') return Response.json({ Code: 10013 }, { status: 401 });
      return Response.json({ Code: 1000, User: { ID: 'me' } });
    }) as typeof fetch;
    const transport = new ProtonTransport(() => 'web-mail@5.0.141.8', saved, fetcher);
    await Promise.all([transport.request('core/v4/users', {}, credential), transport.request('core/v4/users', {}, credential)]);
    expect(rotations).toBe(1); expect(credential.refresh).toBe('rotated'); expect(saved).toHaveBeenCalledOnce();
  });
  it('rejects arbitrary remote URLs and surfaces human verification honestly', async () => {
    const fetcher = vi.fn(async () => Response.json({ Code: 9001, Error: 'challenge' }, { status: 422 })) as typeof fetch;
    const transport = new ProtonTransport(() => 'web-mail@5.0.141.8', async () => {}, fetcher);
    await expect(transport.request('https://example.test/steal')).rejects.toThrow('Invalid Proton API path');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(transport.request('core/v4/auth')).rejects.toThrow('human verification');
  });
});
