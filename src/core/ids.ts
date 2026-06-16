// ID generation — pure helper. Uses the Web Crypto UUID (available in browsers
// and Node 18+). Kept tiny and dependency-free so core stays portable.

export function newId(): string {
  return crypto.randomUUID();
}
