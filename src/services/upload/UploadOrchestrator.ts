import { createClient } from '@supabase/supabase-js';
import { FileSignatureValidator } from './FileSignatureValidator';
import { R2StorageService } from './R2StorageService';
import { ProfileRepository } from '../../lib/supabase/repositories/ProfileRepository';

// Folder → DB column mapping for old-file cleanup
const FOLDER_TO_DB_COLUMN: Record<string, { table: string; column: string; idColumn: string }> = {
  avatars: { table: 'profiles', column: 'avatar_url', idColumn: 'id' },
  banners: { table: 'profiles', column: 'banner_url', idColumn: 'id' },
  playlists: { table: 'playlists', column: 'cover_url', idColumn: 'id' },
};

export class UploadOrchestrator {
  private storage: R2StorageService;

  constructor() {
    this.storage = new R2StorageService();
  }

  /**
   * Step 1: Generates a presigned URL for direct-to-S3 upload.
   */
  public async presign(params: {
    userId: string;
    folder: string;
    extension: string;
    contentType: string;
  }): Promise<{ uploadUrl: string; pendingKey: string }> {
    const { userId, folder, extension, contentType } = params;

    // 1. Validate folder
    const validFolders = ['avatars', 'banners', 'playlists', 'uploads'];
    if (!validFolders.includes(folder)) {
      throw new Error(`Invalid folder: ${folder}`);
    }

    // 2. Validate extension
    if (!FileSignatureValidator.isSupportedExtension(extension)) {
      throw new Error(`Unsupported extension: ${extension}`);
    }

    // 3. Generate pending key
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const pendingKey = `pending/${folder}/${userId}_${timestamp}_${randomString}.${extension}`;

    // 4. Generate presigned URL
    const uploadUrl = await this.storage.generatePresignedUploadUrl(pendingKey, contentType);

    return { uploadUrl, pendingKey };
  }

  /**
   * Step 2: Verifies magic bytes of the uploaded file and promotes it to permanent storage.
   */
  public async verify(params: {
    userId: string;
    pendingKey: string;
    folder: string;
    playlistId?: string;
    supabaseToken: string;
  }): Promise<{ publicUrl: string }> {
    const { userId, pendingKey, folder, playlistId, supabaseToken } = params;

    // 1. Security Check: ensure key starts with pending/ and contains the user's ID
    if (!pendingKey.startsWith(`pending/${folder}/`)) {
      throw new Error('Invalid pending key format.');
    }
    if (!pendingKey.includes(`/${userId}_`)) {
      throw new Error('Unauthorized to verify this file.');
    }

    // 2. Fetch the first 64 bytes for magic bytes validation
    let buffer: Uint8Array;
    try {
      buffer = await this.storage.getObjectHead(pendingKey, 64);
    } catch (err) {
      console.error(`[UploadOrchestrator] Failed to fetch pending file ${pendingKey}:`, err);
      throw new Error('Pending file not found in storage. Ensure upload completed successfully.');
    }

    // 3. Validate magic bytes
    const { valid, detectedMime } = FileSignatureValidator.validate(buffer);

    if (!valid) {
      console.warn(`[SECURITY] User ${userId} attempted to upload a fake/malicious file at ${pendingKey}`);
      // Immediately delete the malicious file
      await this.storage.deleteObject(pendingKey).catch(console.error);
      throw new Error('Malicious payload detected. Fake file rejected and deleted.');
    }

    // 4. Promote to permanent storage
    const finalKey = pendingKey.replace('pending/', '');
    await this.storage.copyObject(pendingKey, finalKey);
    await this.storage.deleteObject(pendingKey); // Cleanup the pending object

    // 5. Delete old file from storage (Cleanup)
    await this.cleanupOldFile({ userId, folder, playlistId, supabaseToken }).catch(err => {
      console.warn('[UploadOrchestrator] Failed to delete old file during cleanup:', err);
    });

    // 6. Return the final public URL
    const publicUrl = this.storage.getPublicUrl(finalKey);
    return { publicUrl };
  }

  /**
   * Cleans up the user's previous file in storage based on folder mapping.
   */
  private async cleanupOldFile(params: {
    userId: string;
    folder: string;
    playlistId?: string;
    supabaseToken: string;
  }): Promise<void> {
    const mapping = FOLDER_TO_DB_COLUMN[params.folder];
    if (!mapping) return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) return;

    // Create a user-scoped client
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${params.supabaseToken}` } },
    });

    let oldUrl: string | null = null;

    if (params.folder === 'playlists' && params.playlistId) {
      const { data } = await supabase
        .from(mapping.table)
        .select(mapping.column)
        .eq(mapping.idColumn, params.playlistId)
        .eq('user_id', params.userId)
        .maybeSingle();
      oldUrl = (data as any)?.[mapping.column] || null;
    } else if (params.folder === 'avatars' || params.folder === 'banners') {
      // Could also use ProfileRepository here, but direct query ensures we use the user's RLS context
      const { data } = await supabase
        .from(mapping.table)
        .select(mapping.column)
        .eq(mapping.idColumn, params.userId)
        .maybeSingle();
      oldUrl = (data as any)?.[mapping.column] || null;
    }

    if (oldUrl) {
      const oldKey = this.storage.extractKeyFromPublicUrl(oldUrl);
      if (oldKey && oldKey.includes(`/${params.userId}_`)) {
        await this.storage.deleteObject(oldKey);
      }
    }
  }
}
