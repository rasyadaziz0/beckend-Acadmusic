import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from '../../middleware/auth';

export const getSocialFeed = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase Service Key');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Use service role key to bypass RLS, then strictly filter by user's following list and target users' privacy settings.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get the list of users this user is following
    const { data: follows, error: followError } = await supabaseAdmin
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (followError) {
      console.error('Error fetching follows:', followError.message);
      return res.status(500).json({ error: 'Failed to fetch social feed' });
    }

    if (!follows || follows.length === 0) {
      return res.status(200).json({ data: [] });
    }

    const followingIds = follows.map((f: any) => f.following_id);

    // 2. Fetch listening history of those users, joining with profiles to enforce privacy
    const { data: history, error: historyError } = await supabaseAdmin
      .from('listening_history')
      .select(`
        id,
        user_id,
        track_id,
        played_at,
        profiles!inner (
          id,
          username,
          display_name,
          avatar_url,
          is_public,
          show_recently_played
        )
      `)
      .in('user_id', followingIds)
      .not('profiles.is_public', 'is', false)
      .not('profiles.show_recently_played', 'is', false)
      .order('played_at', { ascending: false })
      .limit(30);

    if (historyError) {
      console.error('Error fetching history:', historyError.message);
      return res.status(500).json({ error: 'Failed to fetch social feed' });
    }

    return res.status(200).json({ data: history ?? [] });
  } catch (err: any) {
    console.error('Social feed error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch social feed' });
  }
};
