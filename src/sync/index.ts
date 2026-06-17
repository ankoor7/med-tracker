// Sync client.
// The Supabase backend implements the `SyncBackend` port (pull via PostgREST,
// push via the `push_records` RPC). The sync engine drives it: pull/push
// orchestration, change tracking, offline queue, LWW conflict resolution, and
// tombstones.
export * from './supabaseBackend';
export * from './recordMapping';
export * from './syncEngine';
export { useSync, type SyncPhase, type SyncStatus, type UseSync } from './useSync';
