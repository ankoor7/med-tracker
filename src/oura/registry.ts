// Active Oura client registry — mirrors `store/repository.ts`. The store calls
// `getOuraClient()` so it never hard-wires mock vs live; tests and `main.tsx`
// swap the client via `setOuraClient`. Lazily built from env on first use
// (mock by default — see config.ts).

import { parseOuraConfig } from './config';
import { createOuraClient, type OuraClient } from './ouraClient';

let active: OuraClient | null = null;

export function getOuraClient(): OuraClient {
  if (!active) {
    active = createOuraClient(
      parseOuraConfig(import.meta.env as Record<string, string | undefined>),
    );
  }
  return active;
}

export function setOuraClient(client: OuraClient): void {
  active = client;
}
