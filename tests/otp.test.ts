import { describe, it, expect } from 'vitest';
import { defaults, preferences } from '../src/core/model';
import { extractCodes, plainText, notificationKey } from '../src/core/otp';
const detect = (subject: string, body: string, options = defaults().otp) => extractCodes(subject, body, options).map(code => code.value);
describe('Original QuickCode extraction', () => {
  it('decodes entities, strips executable tags, preserves grouping boundaries', () => {
    expect(plainText('<script>123456</script><p>Code&nbsp;: 765&#52;32</p>')).toBe('Code : 765432');
    expect(detect('', '<p>Code: 123 456</p>')).toEqual(['123456']);
    expect(detect('', 'Your token: Ab-12-cD')).toEqual(['Ab12cD']);
  });
  it('rejects years, amounts and invalid lengths', () => {
    expect(detect('', 'Year 1998; $1456; 5678€; 123456789; code: 738291')).toEqual(['738291']);
  });
  it('scores body context above subject and quoted replies', () => {
    expect(detect('Code: 981723', 'Use code: 456782\n> Code: 123456')[0]).toBe('456782');
  });
  it('finds subject-only codes and limits unique matches', () => {
    expect(detect('OTP: 987321', '')).toEqual(['987321']);
    const result = detect('', 'Code: 123456, 123456, 234567, 345678, 456789');
    expect(result).toHaveLength(3); expect(new Set(result).size).toBe(3);
  });
  it('runs custom captures globally and ignores disabled, malformed and risky regex', () => {
    const options = { ...defaults().otp, builtIn: false, context: false, patterns: [
      { id: 'one', name: 'Ticket', expression: 'ticket=(\\w+)', flags: 'i', enabled: true },
      { id: 'two', name: '', expression: '[', flags: '', enabled: true },
      { id: 'three', name: '', expression: '(a+)+$', flags: '', enabled: true },
      { id: 'four', name: '', expression: '(777777)', flags: '', enabled: false },
    ] };
    expect(detect('', 'ticket=Ab1234 ticket=Cd5678 777777', options)).toEqual(['Ab1234', 'Cd5678']);
  });
  it('allows context detection while built-ins are disabled', () => {
    expect(detect('', 'token: 987321', { ...defaults().otp, builtIn: false })).toEqual(['987321']);
    expect(detect('', 'random 987321', { ...defaults().otp, builtIn: false })).toEqual([]);
  });
  it('produces stable message-based IDs', async () => {
    expect(await notificationKey('message-a')).toBe(await notificationKey('message-a'));
    expect(await notificationKey('message-a')).not.toBe(await notificationKey('message-b'));
  });
  it('normalizes untrusted preference imports', () => {
    const result = preferences({ theme: 'unknown', pollSeconds: -1, width: 30000, otp: { patterns: [{ expression: 42 }] }, accounts: { a: null }, quiet: [{ contains: '' }] });
    expect(result.theme).toBe('evergreen'); expect(result.pollSeconds).toBe(30); expect(result.width).toBe(800);
    expect(result.otp.patterns).toEqual([]); expect(result.accounts).toEqual({}); expect(result.quiet).toEqual([]);
  });
});
