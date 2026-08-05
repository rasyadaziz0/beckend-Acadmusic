import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { searchITunesTracks } from '../../lib/itunesApi';
import { PlaylistRepository } from '../../lib/supabase/repositories/PlaylistRepository';

function getBearerToken(request: Request) {
  const authorization = request.headers.authorization ?? '';
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

interface ImportTrack {
  title: string;
  artist: string;
  duration?: number;
}

interface ImportProcessBody {
  playlistId: string;
  tracks: ImportTrack[];
}

export const postImportProcess = async (req: Request, res: Response) => {
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

    // Create Supabase client with user's JWT so RLS applies
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // Verify user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { playlistId, tracks } = req.body as ImportProcessBody;

    if (!playlistId || !Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({ error: 'playlistId dan tracks diperlukan.' });
    }

    // 1. Initialize job in import_jobs table
    const { data: job, error: jobError } = await supabase
      .from('import_jobs')
      .insert({
        user_id: user.id,
        playlist_id: playlistId,
        total_tracks: tracks.length,
        processed_tracks: 0,
        success_tracks: 0,
        status: 'processing'
      })
      .select('id')
      .single();

    if (jobError || !job) {
      console.error('[Import] Failed to create job:', jobError);
      return res.status(500).json({ error: 'Gagal membuat job import.' });
    }

    // Immediately respond 202 — work continues in background
    res.status(202).json({
      success: true,
      message: `Import ${tracks.length} lagu sedang diproses di latar belakang.`,
    });

    // --- Background processing (fire-and-forget) ---
    // Use service_role key for background updates to avoid token expiration issues
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    
    const repo = new PlaylistRepository(supabaseAdmin);
    let successCount = 0;
    let processedCount = 0;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      try {
        const query = `${track.title} ${track.artist}`.trim();
        const songs = await searchITunesTracks(query, 1);

        if (songs.length > 0) {
          const bestMatch = songs[0];
          await repo.addTrackToPlaylist(playlistId, bestMatch.id);
          successCount++;
        }
      } catch (err: any) {
        console.warn(`[Import] Failed to resolve track "${track.title}": ${err?.message || 'Unknown'}`);
      }

      processedCount++;

      // Update progress in database
      await supabaseAdmin
        .from('import_jobs')
        .update({
          processed_tracks: processedCount,
          success_tracks: successCount
        })
        .eq('id', job.id);

      // Anti rate-limit delay (skip on last track)
      if (i < tracks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2750));
      }
    }

    // Mark job as completed
    await supabaseAdmin
      .from('import_jobs')
      .update({ status: 'completed' })
      .eq('id', job.id);

    console.log(`[Import] Job ${job.id} Completed: ${successCount}/${tracks.length} tracks added to playlist ${playlistId}`);
  } catch (error: any) {
    // If headers already sent (202), just log
    if (res.headersSent) {
      console.error('[Import] Background error:', error);
      return;
    }
    console.error('[Import] Error:', error);
    return res.status(500).json({ error: error.message || 'Import gagal.' });
  }
};
