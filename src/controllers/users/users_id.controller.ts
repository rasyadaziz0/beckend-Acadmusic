import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

export const getUsersId = async (req: Request, res: Response) => {
try {
const { id: userId } = req.params;

if (!userId) {
  return res.status(400).json({ error: 'User ID is required' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  return res.status(500).json({ error: 'Supabase configuration missing' });
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Fetch profile
const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('id, username, display_name, bio, avatar_url, created_at')
  .eq('id', userId)
  .maybeSingle();

if (profileError) {
  console.error('Profile fetch error:', profileError.message);
  return res.status(500).json({ error: 'Failed to fetch profile' });
}

if (!profile) {
  return res.status(404).json({ error: 'User not found' });
}

// Fetch follow counts
const [followerResult, followingResult] = await Promise.all([
  supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_id', userId),
  supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId),
]);

// Fetch public playlists
const { data: playlists } = await supabase
  .from('playlists')
  .select('id, name, description, cover_url, is_public, created_at')
  .eq('user_id', userId)
  .eq('is_public', true)
  .order('created_at', { ascending: false });

return res.status(200).json({
  profile,
  followCounts: {
    followers: followerResult.count ?? 0,
    following: followingResult.count ?? 0,
  },
  publicPlaylists: playlists ?? [],
});
} catch {
return res.status(500).json({ error: 'Failed to fetch user data' });
}
};

