import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

export const getUsersSearch = async (req: Request, res: Response) => {
try {
const query = (req.query.q as string)?.trim();
const limit = Math.min(Number(req.query.limit ?? 20), 50);

if (!query || query.length < 2) {
  return res.status(200).json({ users: [] });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  return res.json({ error: 'Supabase configuration missing' });
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const { data, error } = await supabase
  .from('profiles')
  .select('id, username, display_name, bio, avatar_url, created_at')
  .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
  .limit(limit);

if (error) {
  console.error('User search error:', error.message);
  return res.status(500).json({ error: 'Search failed' });
}

return res.status(200).json({ users: data ?? [] });
} catch {
return res.status(500).json({ error: 'Search failed' });
}
};

