export interface SrpChallenge { Version: number; Modulus: string; ServerEphemeral: string; Username?: string; Salt: string; SRPSession: string }
export function getSrp(challenge: SrpChallenge, credential: { username: string; password: string }): Promise<{ clientEphemeral: string; clientProof: string; expectedServerProof: string }>;
export function computeKeyPassword(password: string, salt: string): Promise<string>;
