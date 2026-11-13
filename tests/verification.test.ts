import { describe, it, expect, vi } from 'vitest';
import { VerificationRequests } from '../src/background/verification';
import { captchaResult, captchaURL, challengeFrom } from '../src/proton/verification';
import { ProtonTransport } from '../src/proton/api';
describe('human verification', () => {
  it('replays only the challenged request with the same proof and verification headers', async () => {
    const data = { ClientProof: 'proof', SRPSession: 'session' };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ Code: 9001, Details: { HumanVerificationToken: 'challenge', HumanVerificationMethods: ['captcha'] } }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ Code: 1000 }));
    const verify = vi.fn(async () => 'solved');
    const api = new ProtonTransport(() => 'test', async () => {}, fetcher);
    await api.request('core/v4/auth', { method: 'POST', data, verify });
    expect(verify).toHaveBeenCalledWith({ token: 'challenge' });
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ 'x-pm-human-verification-token': 'solved', 'x-pm-human-verification-token-type': 'captcha' });
    fetcher.mockResolvedValueOnce(Response.json({ Code: 1000 })); await api.request('core/v4/users');
    expect(fetcher.mock.calls[2][1].headers['x-pm-human-verification-token']).toBeUndefined();
  });
  it('stops after one rejected solution and rejects unsupported challenge methods', async () => {
    const fetcher = vi.fn(async () => Response.json({ Code: 9001, Details: { HumanVerificationToken: 'challenge', HumanVerificationMethods: ['captcha'] } }, { status: 422 }));
    const verify = vi.fn(async () => 'solved');
    await expect(new ProtonTransport(() => 'test', async () => {}, fetcher).request('core/v4/auth', { verify })).rejects.toThrow('did not accept');
    expect(fetcher).toHaveBeenCalledTimes(2); expect(verify).toHaveBeenCalledOnce();
    expect(() => challengeFrom({ HumanVerificationMethods: ['sms'] })).toThrow('does not support');
  });
  it('checks both the exact frame window and origin, preserves token case and encodes challenge URLs', () => {
    const source = {} as Window;
    const event = { source, origin: 'https://mail-api.proton.me', data: { type: 'pm_captcha', token: 'ExactCase' } } as MessageEvent;
    expect(captchaResult(event, source)).toBe('ExactCase');
    expect(captchaResult({ ...event, origin: 'https://evil.test' } as MessageEvent, source)).toBeUndefined();
    expect(captchaResult(event, {} as Window)).toBeUndefined();
    expect(captchaResult({ ...event, data: { type: 'pm_captcha', token: 'bad\r\nheader' } } as MessageEvent, source)).toBeUndefined();
    expect(new URL(captchaURL('a&b')).searchParams.get('Token')).toBe('a&b');
  });
  it('binds completion to the initiating document and consumes a challenge once', async () => {
    const publish = vi.fn(async () => {}); const broker = new VerificationRequests(publish);
    const pending = broker.verifier('id', 'doc')({ token: 'challenge' });
    expect(broker.finish('id', 'other', 'stolen')).toBe(false);
    expect(broker.finish('id', 'doc', 'solved')).toBe(true); expect(await pending).toBe('solved');
    expect(broker.finish('id', 'doc', 'replay')).toBe(false);
  });
  it('expires pending requests and supports cancellation', async () => {
    vi.useFakeTimers();
    try {
      const broker = new VerificationRequests(async () => {}, 100);
      const pending = broker.verifier('id', 'doc')({ token: 'challenge' });
      const check = expect(pending).rejects.toThrow('expired'); await vi.advanceTimersByTimeAsync(101); await check;
      const cancelled = broker.verifier('next', 'doc')({ token: 'challenge' });
      const cancelledCheck = expect(cancelled).rejects.toThrow('cancelled'); broker.finish('next', 'doc'); await cancelledCheck;
    } finally { vi.useRealTimers(); }
  });
});
