import { describe, it, expect } from 'vitest';
import { getSrp } from '../src/proton/sdk.js';
import fixture from './fixtures/proton-srp.json';
describe('Real SRP SDK integration', () => {
  it('verifies Proton’s public modulus fixture and generates full proofs through an initialized crypto endpoint', async () => {
    const result = await getSrp(fixture.challenge, { username: 'jakubqa', password: 'abc123' });
    expect(atob(result.clientEphemeral)).toHaveLength(256);
    expect(atob(result.clientProof)).toHaveLength(256);
    expect(atob(result.expectedServerProof)).toHaveLength(256);
    expect(result.clientProof).not.toBe(result.expectedServerProof);
  });
  it('rejects an altered server modulus signature', async () => {
    const challenge = { ...fixture.challenge, Modulus: fixture.challenge.Modulus.replace('W2z5H', 'X2z5H') };
    await expect(getSrp(challenge, { username: 'jakubqa', password: 'abc123' })).rejects.toThrow();
  });
});
