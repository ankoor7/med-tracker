// Crypto module — stub.
// The cloud is NOT zero-knowledge (see specs/02-architecture.md §7); there is no
// end-to-end encryption. Stage 4 may use this module for an OPTIONAL on-device
// lock that encrypts the local IndexedDB cache at rest (Web Crypto AES-GCM) as a
// convenience defense for a shared/lost device — disabled by default.
// Intentionally empty for Stages 0–3.
export {};
