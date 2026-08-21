import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';
import { generateDiscoverWeeklyForUser } from '../../services/discover/discoverService';

// We need the service role key to fetch all profiles, bypassing RLS
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Redis instance for distributed locks
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    })
  : null;

export const getCronDiscover = async (req: Request, res: Response) => {
  let lockKey = '';
  let lockToken = '';
  let heartbeatTimer: NodeJS.Timeout | null = null;

  try {
    // 1. Verify cron secret to prevent unauthorized execution
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.warn('Missing SUPABASE_SERVICE_ROLE_KEY for cron job');
      return res.status(500).json({ error: 'Server configuration missing' });
    }
    
    const timezonesParam = req.query.timezones as string;
    if (!timezonesParam) {
      return res.status(400).json({ error: 'Missing timezones parameter' });
    }
    
    // Canonicalize and validate timezones
    const rawTzs = timezonesParam.split(',').map(tz => tz.trim()).filter(Boolean);
    const supportedTzs = new Set(Intl.supportedValuesOf('timeZone'));
    
    for (const tz of rawTzs) {
      if (!supportedTzs.has(tz)) {
        return res.status(400).json({ error: `Invalid timezone: ${tz}` });
      }
    }
    
    const canonicalTimezones = Array.from(new Set(rawTzs)).sort().join(',');
    
    // Attempt to acquire distributed lock
    if (redis) {
      lockToken = randomUUID();
      lockKey = `cron:discover:lock:${canonicalTimezones}`;
      
      // Lock for 300 seconds (5 minutes)
      const acquired = await redis.set(lockKey, lockToken, { nx: true, ex: 300 });
      if (!acquired) {
        console.log(`[Discover Cron] Execution already in progress for ${canonicalTimezones}. Aborting duplicate.`);
        return res.status(429).json({ message: 'Execution already in progress' });
      }

      // Start heartbeat to renew lock while job is running (every 2 minutes)
      heartbeatTimer = setInterval(async () => {
        try {
          await redis.eval(
            'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], 300) else return 0 end',
            [lockKey],
            [lockToken]
          );
        } catch (e) {
          console.error('[Discover Cron] Failed to renew lock heartbeat:', e);
        }
      }, 120_000);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const matchingTimezones = canonicalTimezones.split(',');

    // 2. Fetch user profile IDs matching the current timezones
    // Also fetch users where timezone IS NULL as a fallback, but ONLY do this
    // once a week (e.g. when Asia/Jakarta is triggered) to avoid generating 24 times a day for them.
    const includeNulls = matchingTimezones.includes('Asia/Jakarta');
    
    let query = supabaseAdmin.from('profiles').select('id');
    
    if (includeNulls) {
      // Supabase PostgREST syntax for OR conditions on the same column isn't natively "IN (...) OR IS NULL"
      // We can use the .or() syntax:
      const inQuery = matchingTimezones.map(tz => `"${tz}"`).join(',');
      query = query.or(`timezone.in.(${inQuery}),timezone.is.null`);
    } else {
      query = query.in('timezone', matchingTimezones);
    }
    
    const { data: profiles, error: profileError } = await query;

    if (profileError) {
      throw new Error(`Failed to fetch profiles: ${profileError.message}`);
    }

    if (!profiles || profiles.length === 0) {
      return res.json({ message: 'No users found for these timezones' });
    }

    const results = {
      totalUsers: profiles.length,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [] as any[],
    };

    // 3. Process each user sequentially to avoid overwhelming Gemini/iTunes APIs
    for (const profile of profiles) {
      try {
        await generateDiscoverWeeklyForUser(supabaseAdmin, profile.id);
        results.successCount++;
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'insufficient_history') {
          results.skippedCount++;
        } else {
          results.failedCount++;
          results.errors.push({ userId: profile.id, error: msg });
          console.error(`Discover Weekly generation failed for user ${profile.id}:`, err);
        }
      }
    }

    console.log(
      `[Discover Cron] Done — Total: ${results.totalUsers}, ` +
      `Success: ${results.successCount}, Skipped: ${results.skippedCount}, ` +
      `Failed: ${results.failedCount}`
    );

    return res.json({
      message: 'Discover Weekly generation completed',
      results,
    });
  } catch (err: any) {
    console.error('Discover Weekly cron error:', err);
    return res.status(500).json({ error: 'Failed to execute Discover Weekly cron job' });
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (redis && lockKey && lockToken) {
      await redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        [lockKey],
        [lockToken]
      ).catch(() => {});
    }
  }
};
