import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getWeeklyListeningHistory } from '../../lib/supabase/music';
import {
  hasEnoughHistory,
  getMinTracksThreshold,
  generateDiscoverWeeklyForUser,
} from '../../services/discover/discoverService';

export const postAiDiscover = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Call the generator with the authenticated server client
    const result = await generateDiscoverWeeklyForUser(supabase, user.id);
    return res.json(result);
  } catch (err: any) {
    console.error('Discover Weekly generation error:', err);
    return res.status(500).json({ error: 'Failed to generate Discover Weekly' });
  }
};

export const getAiDiscover = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if Discover Weekly playlist exists
    const { data: playlist } = await supabase
      .from('playlists')
      .select('id, name, discover_generated_at, created_at')
      .eq('user_id', user.id)
      .eq('is_discover_weekly', true)
      .maybeSingle();

    if (!playlist) {
      // Check listening history count for progress bar
      const weeklyHistory = await getWeeklyListeningHistory(supabase, user.id, 7);
      const uniqueCount = new Set(weeklyHistory.map((r: any) => r.track_id)).size;

      return res.json({
        exists: false,
        listeningProgress: {
          current: uniqueCount,
          required: getMinTracksThreshold(),
          ready: hasEnoughHistory(uniqueCount),
        },
      });
    }

    // Check if it's stale (older than 7 days)
    const generatedAt = playlist.discover_generated_at
      ? new Date(playlist.discover_generated_at)
      : null;
    const isStale = !generatedAt || Date.now() - generatedAt.getTime() > 7 * 24 * 60 * 60 * 1000;

    // Get weekly history for progress
    const weeklyHistory = await getWeeklyListeningHistory(supabase, user.id, 7);
    const uniqueCount = new Set(weeklyHistory.map((r: any) => r.track_id)).size;

    return res.json({
      exists: true,
      playlistId: playlist.id,
      generatedAt: playlist.discover_generated_at,
      isStale,
      listeningProgress: {
        current: uniqueCount,
        required: getMinTracksThreshold(),
        ready: hasEnoughHistory(uniqueCount),
      },
    });
  } catch (err: any) {
    console.error('Discover Weekly status error:', err);
    return res.status(500).json({ error: 'Failed to check Discover Weekly status' });
  }
};
