import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

type CreatePlaylistBody = {
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

export const postPlaylists = async (req: Request, res: Response) => {
try {
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

const body = (req.body) as CreatePlaylistBody;
const name = body.name?.trim();
if (!name) {
  return res.status(400).json({ error: 'Playlist name is required' });
}

const payload = {
  user_id: user.id,
  name,
  description: body.description?.trim() || null,
  cover_url: body.coverUrl?.trim() || null,
  is_public: body.isPublic ?? false,
};

const { data, error } = await supabase
  .from('playlists')
  .insert(payload)
  .select('id, user_id, name, description, cover_url, created_at')
  .single();

if (error) {
  console.error('Playlist insert error:', error.message);
  return res.status(500).json({ error: 'Failed to create playlist' });
}

return res.status(201).json(data);
} catch {
return res.status(500).json({ error: 'Failed to create playlist' });
}
};

