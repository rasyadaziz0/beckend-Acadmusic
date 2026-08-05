import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

type UpdatePlaylistBody = {
  name?: string;
  description?: string;
  coverUrl?: string;
  isPublic?: boolean;
};

function getBearerToken(request: Request) {
  const authorization = request.headers.authorization ?? '';
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export const putPlaylistsId = async (req: Request, res: Response) => {
try {
const { id } = req.params;
const token = getBearerToken(req);
if (!token) {
  return res.status(401).json({ error: 'Unauthorized' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  return res.status(500).json({ error: 'Supabase configuration missing' });
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});

const {
  data: { user },
  error: userError,
} = await supabase.auth.getUser(token);

if (userError || !user) {
  return res.status(401).json({ error: 'Unauthorized' });
}

const body = (req.body) as UpdatePlaylistBody;
const name = body.name?.trim();
if (!name) {
  return res.status(400).json({ error: 'Playlist name is required' });
}

const payload: any = {
  name,
  description: body.description?.trim() || null,
  cover_url: body.coverUrl?.trim() || null,
};

if (body.isPublic !== undefined) {
  payload.is_public = body.isPublic;
}

const { data, error } = await supabase
  .from('playlists')
  .update(payload)
  .eq('id', id)
  .eq('user_id', user.id)
  .select('id, user_id, name, description, cover_url, created_at')
  .single();

if (error) {
  console.error('Playlist update error:', error.message);
  return res.status(500).json({ error: 'Failed to update playlist' });
}

return res.status(200).json(data);
} catch {
return res.status(500).json({ error: 'Failed to update playlist' });
}
};

