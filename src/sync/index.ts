// Sync client.
// Stage 3 adds the authorized API client (auth + /sync endpoints).
// Stage 5 adds the full sync engine: pull/push orchestration, change tracking,
// offline queue, LWW conflict resolution, and tombstones.
export * from './apiClient';
