# Stage 4 Spec — End-to-End Encryption

| | |
|---|---|
| **Depends on** | Stage 2 |
| **Implements** | FR-ENC-1..3; architecture §7 |
| **Milestone** | B |
| **Status** | Ready after Stage 2 (integrates with Stage 5) |

## 1. Objective
Encrypt all user data **on-device** so the cloud only ever stores ciphertext. Provide passphrase-based key derivation, envelope encryption of records, unlock/lock, passphrase change, and a recovery mechanism — wrapping the Stage 2 repository transparently.

## 2. Scope
**In:** crypto module (Web Crypto); KDF; envelope keys (KEK/DEK); per-record AES-GCM encrypt/decrypt; passphrase setup/unlock; recovery code; passphrase change (re-wrap, no data re-encrypt); encrypted-at-rest local store.
**Out:** transport/sync (Stage 5 sends the ciphertext); server changes (server already opaque from Stage 3).

## 3. Prerequisites
Stage 2 repository + record metadata.

## 4. Functional requirements
- FR-4.1. Records are encrypted before they leave the domain core for storage/transport; decrypted only after unlock.
- FR-4.2. Keys derive from the user passphrase on-device; **no key material is sent to the server**.
- FR-4.3. A **recovery code** can unlock the data key independently of the passphrase.
- FR-4.4. Changing the passphrase re-wraps the data key only (no bulk re-encryption).
- FR-4.5. Without passphrase or recovery code, data is cryptographically unrecoverable (and the UI says so).

## 5. Technical approach
- **Primitives:** AES-GCM-256 (record payloads, random 96-bit IV per record); KDF Argon2id (params tuned for mobile; PBKDF2-SHA-256 high-iteration as a Web-Crypto-native fallback); CSPRNG via `crypto.getRandomValues`.
- **Key hierarchy (envelope):** passphrase → KEK (KDF + per-user salt); random DEK encrypts records; DEK stored **wrapped** by KEK (and, separately, by a recovery-code-derived key). Salts + wrapped DEKs persist in `meta` (local) and sync as opaque blobs.
- **Crypto module API:**
```ts
interface Crypto {
  setupNewVault(passphrase: string): Promise<{ recoveryCode: string }>;
  unlock(passphrase: string): Promise<void>;
  unlockWithRecovery(code: string): Promise<void>;
  changePassphrase(oldPass: string, newPass: string): Promise<void>;
  encryptRecord(plain: object): Promise<Ciphertext>; // {iv, data}
  decryptRecord(ct: Ciphertext): Promise<object>;
  isUnlocked(): boolean;
  lock(): void;
}
```
- **Repository wrapper:** `EncryptedRepository` decorates `LocalRepository` — encrypts on write, decrypts on read; `id`/`updatedAt`/`version`/`deleted` stay cleartext (needed for sync), payload encrypted.
- **Keys in memory** only while unlocked; cleared on lock/idle.

## 6. Tasks
1. Implement the crypto module (KDF, envelope wrap/unwrap, AES-GCM record ops) with tests.
2. Implement vault setup (generate DEK + recovery code), unlock, unlock-with-recovery.
3. Implement passphrase change (re-wrap DEK) — no data re-encryption.
4. Build `EncryptedRepository` decorator over Stage 2's repository.
5. Add unlock/lock UI gate and recovery-code capture flow (with explicit loss warning).
6. Verify all Stage 1–2 flows still work behind the encrypted store.

## 7. Acceptance criteria
- AC1. Given data is written, when the underlying IndexedDB/blob is inspected, payloads are ciphertext (no plaintext fields).
- AC2. Given the correct passphrase, when unlocking, records decrypt and the app works normally.
- AC3. Given the wrong passphrase, when unlocking, it fails without revealing plaintext.
- AC4. Given the recovery code, when used, the vault unlocks even if the passphrase is unknown.
- AC5. Given a passphrase change, when re-unlocked with the new passphrase, all existing data decrypts (no re-encrypt needed).
- AC6. Given neither passphrase nor recovery code, when attempting access, recovery is impossible and the UI states this.

## 8. Test plan
- Encrypt→decrypt round-trips; wrong-key failure; IV uniqueness.
- Recovery-code path; passphrase-change re-wrap; lock clears keys.
- Tamper test: modified ciphertext fails GCM auth.

## 9. Risks / decisions
- **Decision:** E2E (zero-knowledge) over server-side encryption, per data-rights priority; recovery code mitigates key-loss (documented tradeoff).
- Tune Argon2id for acceptable mobile unlock latency; document parameters.
- Never log key material; clear buffers on lock.

## 10. Definition of done
All ACs pass; on-disk/at-rest payloads verified ciphertext; recovery and passphrase-change work; app fully functional behind the encrypted repository.
