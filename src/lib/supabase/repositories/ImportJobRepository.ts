import { SupabaseClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────

export interface ImportJob {
  id: string;
  user_id: string;
  playlist_id: string;
  total_tracks: number;
  processed_tracks: number;
  success_tracks: number;
  status: ImportJobStatus;
  created_at?: string;
}

export type ImportJobStatus = 'processing' | 'completed' | 'cancelled' | 'queued' | 'retrying';

// ── Repository ────────────────────────────────────────────────────

/**
 * ImportJobRepository — encapsulates all CRUD operations on the `import_jobs` table.
 *
 * Follows the same OOP Repository Pattern used by PlaylistRepository, LikeRepository, etc.
 * All status transitions use conditional WHERE clauses to prevent race conditions.
 */
export class ImportJobRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new import job with status 'processing'.
   */
  async createJob(
    userId: string,
    playlistId: string,
    totalTracks: number,
  ): Promise<ImportJob> {
    const { data, error } = await this.supabase
      .from('import_jobs')
      .insert({
        user_id: userId,
        playlist_id: playlistId,
        total_tracks: totalTracks,
        processed_tracks: 0,
        success_tracks: 0,
        status: 'processing' as ImportJobStatus,
      })
      .select('*')
      .single();

    if (error) throw error;
    return data as ImportJob;
  }

  /**
   * Update the progress counters of a job.
   */
  async updateProgress(
    jobId: string,
    processedTracks: number,
    successTracks: number,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('import_jobs')
      .update({
        processed_tracks: processedTracks,
        success_tracks: successTracks,
      })
      .eq('id', jobId);

    if (error) throw error;
  }

  /**
   * Mark a job as completed — ONLY if it is still 'processing'.
   * Returns true if the update actually affected a row (i.e., wasn't already cancelled).
   */
  async completeJob(jobId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('import_jobs')
      .update({ status: 'completed' as ImportJobStatus })
      .eq('id', jobId)
      .eq('status', 'processing')
      .select('id');

    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  /**
   * Mark a job as cancelled — ONLY if it is still 'processing'.
   * Returns true if the update actually affected a row (prevents double-cancel).
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('import_jobs')
      .update({ status: 'cancelled' as ImportJobStatus })
      .eq('id', jobId)
      .eq('status', 'processing')
      .select('id');

    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  /**
   * Check whether a job is still actively processing.
   * Used inside the background loop to detect early cancellation.
   */
  async isJobActive(jobId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('import_jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (error || !data) return false;
    return ['processing', 'queued', 'retrying'].includes(data.status);
  }

  /**
   * Find the most recent active (processing) import job for a user.
   * Returns null if no active job exists.
   */
  async findActiveJob(userId: string): Promise<ImportJob | null> {
    const { data, error } = await this.supabase
      .from('import_jobs')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['processing', 'queued', 'retrying'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as ImportJob) ?? null;
  }
}
