import { describe, expect, it } from 'vitest';
import { SignJWT, generateKeyPair, type KeyLike } from 'jose';
import { UnauthorizedError, authenticate, parseBearer, verifyToken } from './auth';

const ISSUER = 'http://localhost:9229/local_test';

async function makeToken(
  privateKey: KeyLike,
  over: { sub?: string; issuer?: string } = {},
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(over.sub ?? 'user-123')
    .setIssuer(over.issuer ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('parseBearer', () => {
  it('extracts the token', () => {
    expect(parseBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(parseBearer('bearer xyz')).toBe('xyz');
  });
  it('returns null for missing/garbled headers', () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('')).toBeNull();
    expect(parseBearer('Token abc')).toBeNull();
  });
});

describe('verifyToken / authenticate (AC5)', () => {
  it('returns the sub for a valid token', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const token = await makeToken(privateKey, { sub: 'alice' });
    await expect(verifyToken(token, publicKey, { issuer: ISSUER })).resolves.toBe('alice');
  });

  it('rejects when no Authorization header is present', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    await expect(authenticate(undefined, publicKey)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a token signed by a different key', async () => {
    const signer = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const token = await makeToken(signer.privateKey);
    await expect(verifyToken(token, other.publicKey)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a token with the wrong issuer', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const token = await makeToken(privateKey, { issuer: 'http://evil.example' });
    await expect(verifyToken(token, publicKey, { issuer: ISSUER })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects a malformed token', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    await expect(authenticate('Bearer not-a-jwt', publicKey)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
