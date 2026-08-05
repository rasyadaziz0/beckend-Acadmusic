import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { generateDiscoverWeeklyForUser } from '../../services/discover/discoverService';

// We need the service role key to fetch all profiles, bypassing RLS
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const getCronDiscover = async (req: Request, res: Response) => {
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

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const region = req.query.region as string;

    // 2. Fetch user profiles, filtering by region if provided
    let query = supabaseAdmin.from('profiles').select('id');
    if (region) {
      query = query.eq('search_region', region);
    }
    
    const { data: profiles, error: profileError } = await query;

    if (profileError) {
      throw new Error(`Failed to fetch profiles: ${profileError.message}`);
    }

    if (!profiles || profiles.length === 0) {
      return res.json({ message: 'No users found' });
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

    return res.json({
      message: 'Discover Weekly generation completed',
      results,
    });
  } catch (err: any) {
    console.error('Discover Weekly cron error:', err);
    return res.status(500).json({ error: 'Failed to execute Discover Weekly cron job' });
  }
};
