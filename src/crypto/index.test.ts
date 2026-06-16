// @vitest-environment node
// Node env: Web Crypto (crypto.subtle) is a Node 20 global; jsdom lacks subtle.
import { describe, expect, it } from 'vitest';
import { CACHE_LOCK_ENABLED, CacheLockError, open, seal } from './index';

describe('on-device cache lock', () => {
  it('ships disabled by default', () => {
    expect(CACHE_LOCK_ENABLED).toBe(false);
  });

  it('round-trips plaintext through seal/open', async () => {
    const blob = await seal('the local cache', 'correct horse battery staple');
    expect(blob.v).toBe(1);
    expect(blob.ciphertext).not.toContain('the local cache');
    const out = await open(blob, 'correct horse battery staple');
    expect(out).toBe('the local cache');
  });

  it('uses a fresh salt + iv each time (no deterministic ciphertext)', async () => {
    const a = await seal('same input', 'pw');
    const b = await seal('same input', 'pw');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('fails to open with the wrong passphrase (AC6)', async () => {
    const blob = await seal('secret', 'right-passphrase');
    await expect(open(blob, 'wrong-passphrase')).rejects.toBeInstanceOf(CacheLockError);
  });

  it('fails to open tampered ciphertext', async () => {
    const blob = await seal('secret', 'pw');
    const tampered = { ...blob, ciphertext: blob.ciphertext.slice(0, -4) + 'AAAA' };
    await expect(open(tampered, 'pw')).rejects.toBeInstanceOf(CacheLockError);
  });

  it('rejects an empty passphrase', async () => {
    await expect(seal('x', '')).rejects.toBeInstanceOf(CacheLockError);
  });
});
