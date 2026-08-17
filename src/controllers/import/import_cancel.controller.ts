import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ImportJobRepository } from '../../lib/supabase/repositories/ImportJobRepository';
import { PlaylistRepository } from '../../lib/supabase/repositories/PlaylistRepository';

/**
 * POST /api/import/cancel
 *
 * Cancels an active import job for the authenticated user.
 * 1. Finds the user's active (processing) job.
 * 2. Sets its status to 'cancelled' (conditional — only if still processing).
 * 3. Deletes the playlist created for this import (cascade deletes playlist_tracks).
 *
 * Uses service_role client for delete operations to bypass RLS edge cases.
 */
export const postImportCancel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    // Use service_role client for guaranteed write access
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey || supabaseAnonKey);
    const importJobRepo = new ImportJobRepository(supabaseAdmin);
    const playlistRepo = new PlaylistRepository(supabaseAdmin);

    // 1. Find active job for this user
    const activeJob = await importJobRepo.findActiveJob(userId);
    if (!activeJob) {
      return res.status(404).json({ error: 'Tidak ada proses import yang sedang berjalan.' });
    }

    // 2. Cancel the job (conditional — only if still 'processing')
    const wasCancelled = await importJobRepo.cancelJob(activeJob.id);
    if (!wasCancelled) {
      // Job already completed or already cancelled by the time we got here
      return res.status(409).json({ error: 'Import sudah selesai atau sudah dibatalkan.' });
    }

    // 3. Delete the playlist (and cascade-delete its tracks)
    try {
      await playlistRepo.deletePlaylist(activeJob.playlist_id);
    } catch (deleteErr: any) {
      // Log but don't fail the cancel — the job is already cancelled
      console.warn(`[Import Cancel] Failed to delete playlist ${activeJob.playlist_id}:`, deleteErr?.message);
    }

    console.log(`[Import Cancel] Job ${activeJob.id} cancelled by user ${userId}. Playlist ${activeJob.playlist_id} deleted.`);

    return res.status(200).json({
      success: true,
      message: 'Import berhasil dibatalkan.',
    });
  } catch (error: any) {
    console.error('[Import Cancel] Error:', error);
    return res.status(500).json({ error: error.message || 'Gagal membatalkan import.' });
  }
};
