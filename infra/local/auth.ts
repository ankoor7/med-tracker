// JWT verification for the local dev server (matches what the API Gateway JWT
// authorizer does in production). Verifies cognito-local tokens against its
// JWKS. The pure pieces are unit-tested for the unauthenticated-rejection case
// (stage-3 AC5).

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';

export class UnauthorizedError extends Error {}

type VerifyKey = KeyLike | Uint8Array | JWTVerifyGetKey;

/** Extract a bearer token from an Authorization header, or null. */
export function parseBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

/**
 * Verify a JWT and return its `sub` (the user id). Throws UnauthorizedError on
 * any failure — missing/invalid token, bad signature, wrong issuer, no subject.
 */
export async function verifyToken(
  token: string,
  key: VerifyKey,
  opts: { issuer?: string; audience?: string } = {},
): Promise<string> {
  const options = {
    ...(opts.issuer ? { issuer: opts.issuer } : {}),
    ...(opts.audience ? { audience: opts.audience } : {}),
  };
  try {
    // jose overloads key (KeyLike/Uint8Array) vs getKey (function) separately.
    const { payload } =
      typeof key === 'function'
        ? await jwtVerify(token, key as JWTVerifyGetKey, options)
        : await jwtVerify(token, key, options);
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedError('token has no subject');
    }
    return payload.sub;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('invalid token');
  }
}

/** Resolve the user id from an Authorization header, throwing if unauthorised. */
export async function authenticate(
  authHeader: string | undefined,
  key: VerifyKey,
  opts: { issuer?: string; audience?: string } = {},
): Promise<string> {
  const token = parseBearer(authHeader);
  if (!token) throw new UnauthorizedError('missing bearer token');
  return verifyToken(token, key, opts);
}

/** Remote JWKS resolver for a cognito-local user pool issuer. */
export function cognitoLocalJwks(issuer: string) {
  return createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
}
