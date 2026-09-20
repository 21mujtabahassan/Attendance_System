import { adminPool } from '../db/adminClient.js';

let isRefreshing = false;

/**
 * Triggers an asynchronous background refresh of results.mv_subject_stats.
 * Uses CONCURRENTLY on an isolated autocommit client.
 */
export function triggerStatsRefresh(): void {
  if (isRefreshing) {
    console.log('[JOBS] Stats refresh already in progress, skipping duplicate.');
    return;
  }

  isRefreshing = true;
  setImmediate(async () => {
    let client;
    try {
      client = await adminPool.connect();
      console.log('[JOBS] Starting REFRESH MATERIALIZED VIEW CONCURRENTLY results.mv_subject_stats...');
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY results.mv_subject_stats');
      console.log('[JOBS] Materialized view results.mv_subject_stats refreshed successfully.');
    } catch (err) {
      console.error('[JOBS] Failed to refresh materialized view:', err);
    } finally {
      isRefreshing = false;
      if (client) client.release();
    }
  });
}
