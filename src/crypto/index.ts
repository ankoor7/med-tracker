// Optional on-device cache lock (Stage 4).
//
// This is a CONVENIENCE defense for a shared/lost device — it encrypts the local
// IndexedDB cache at rest with a passphrase-derived AES-GCM key (Web Crypto). It
// is NOT the security backbone and NOT zero-knowledge: the cloud is
// server-readable by design (see specs/02-architecture.md §7). Account recovery
// is via the identity provider (email reset), never a cryptographic recovery
// code, so forgetting this passphrase loses only the *local* cache, never the
// cloud copy.
//
// Disabled by default. A later UI iteration can wire it into the repository with
// idle/sign-out auto-lock; this module provides the tested primitive.

/** Feature flag — the lock ships off until wired into the repository + UI. */
export const CACHE_LOCK_ENABLED = false;

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** A self-describing encrypted blob, safe to persist as JSON. */
export interface SealedBlob {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

export class CacheLockError extends Error {}

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new CacheLockError('Web Crypto unavailable');
  }
  return crypto.subtle;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** UTF-8 encode into an ArrayBuffer-backed array (a BufferSource for Web Crypto). */
function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(s));
}

/** Random bytes in an ArrayBuffer-backed array. */
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const baseKey = await subtle().importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt `plaintext` under `passphrase`, returning a persistable blob. */
export async function seal(plaintext: string, passphrase: string): Promise<SealedBlob> {
  if (passphrase.length === 0) throw new CacheLockError('passphrase required');
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, utf8(plaintext));
  return {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ct)),
  };
}

/** Decrypt a blob produced by {@link seal}; throws on a wrong passphrase or tamper. */
export async function open(blob: SealedBlob, passphrase: string): Promise<string> {
  if (blob?.v !== 1) throw new CacheLockError('unsupported blob version');
  const salt = fromBase64(blob.salt);
  const iv = fromBase64(blob.iv);
  const key = await deriveKey(passphrase, salt);
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, key, fromBase64(blob.ciphertext));
    return new TextDecoder().decode(pt);
  } catch {
    // AES-GCM auth-tag failure on a wrong passphrase or tampered ciphertext.
    throw new CacheLockError('could not unlock — wrong passphrase or corrupt data');
  }
}
