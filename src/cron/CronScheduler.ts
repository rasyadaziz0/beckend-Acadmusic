import cron from 'node-cron';
import { TimezoneResolver } from './TimezoneResolver';

/**
 * CronScheduler — Centralized manager for all recurring background jobs.
 *
 * Keeps server.ts clean by encapsulating all cron logic in one place.
 * To add a new cron job, create a private static method and call it from init().
 */
export class CronScheduler {
  private static isInitialized = false;

  /**
   * Initialize all cron jobs. Called once from server.ts after app.listen().
   * Idempotent — safe to call multiple times (only registers once).
   */
  static init(port: number | string, allowedOrigins: string[]): void {
    if (this.isInitialized) {
      console.warn('[CronScheduler] Already initialized, skipping.');
      return;
    }

    this.scheduleDiscoverWeekly(port, allowedOrigins);
    this.isInitialized = true;
    console.log('[CronScheduler] All cron jobs registered.');
  }

  /**
   * Discover Weekly — Every hour at minute 0.
   *
   * Calls the internal /api/cron/discover endpoint which:
   * 1. Fetches user profiles from the database matching the current 12 PM timezones
   * 2. For each user with enough listening history, generates AI recommendations via Gemini
   * 3. Searches iTunes for matching tracks and saves them to the user's Discover Weekly playlist
   */
  private static scheduleDiscoverWeekly(port: number | string, allowedOrigins: string[]): void {
    cron.schedule(
      '0 * * * *', // Run every hour
      async () => {
        const matchingZones = TimezoneResolver.getTimezonesAtMondayMidnight();
        
        console.log(`[CRON] Discover Weekly check — ${matchingZones.length} timezones are currently at Mon 12:00 AM`);
        
        if (matchingZones.length === 0) {
          return; // Nothing to do this hour
        }

        try {
          const cronSecret = process.env.CRON_SECRET;
          if (!cronSecret) {
            console.error('[CRON] CRON_SECRET not set — skipping Discover Weekly.');
            return;
          }

          const timezonesParam = encodeURIComponent(matchingZones.join(','));
          const res = await fetch(`http://localhost:${port}/api/cron/discover?timezones=${timezonesParam}`, {
            headers: {
              'Authorization': `Bearer ${cronSecret}`,
              'Origin': allowedOrigins[0] || 'http://localhost:3000',
            },
          });

          const data = await res.json();

          if (!res.ok) {
            console.error('[CRON] Discover Weekly failed:', data);
            return;
          }

          const results = data.results;
          console.log(
            `[CRON] Discover Weekly completed — ` +
            `Total: ${results?.totalUsers ?? '?'}, ` +
            `Success: ${results?.successCount ?? '?'}, ` +
            `Skipped: ${results?.skippedCount ?? '?'}, ` +
            `Failed: ${results?.failedCount ?? '?'}`
          );
        } catch (error) {
          console.error('[CRON] Discover Weekly error:', error);
        }
      }
    );

    console.log('[CronScheduler] Discover Weekly scheduled: Every hour.');
  }
}
