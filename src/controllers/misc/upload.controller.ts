import { Request, Response } from 'express';

import { createClient } from '@supabase/supabase-js';
import { r2Client } from '../../lib/r2';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Folder → DB column mapping for old-file cleanup
const FOLDER_TO_DB_COLUMN: Record<string, { table: string; column: string; idColumn: string }> = {
  avatars: { table: 'profiles', column: 'avatar_url', idColumn: 'id' },
  banners: { table: 'profiles', column: 'banner_url', idColumn: 'id' },
  playlists: { table: 'playlists', column: 'cover_url', idColumn: 'id' },
};

function extractR2Key(publicUrl: string): string | null {
  try {
    const devUrl = process.env.NEXT_PUBLIC_R2_DEV_URL;
    const knownPrefixes = [
      devUrl,
      'https://img.rasyadazizan.site',
      'https://pub-a5593a1c76374ad6bcfeed25f8cd6e01.r2.dev',
    ].filter(Boolean) as string[];

    for (const prefix of knownPrefixes) {
      const baseUrl = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
      if (publicUrl.startsWith(baseUrl)) {
        const key = publicUrl.slice(baseUrl.length + 1); // +1 for the "/"
        if (key && !key.includes('..')) {
          return key;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const postUpload = async (req: Request, res: Response) => {
  try {
    // Auth handled by requireAuth middleware — user is available via (req as any).user
    const authReq = req as any;
    const user = authReq.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // For Supabase operations that need the user's token
    const authorization = req.headers.authorization ?? '';
    const token = authorization.replace(/^Bearer\s/i, '');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // ── File parsed via Multer ──
    const file = req.file;
    const folder = req.body.folder || 'uploads';
    const playlistId = req.body.playlistId || null; // For playlist cover cleanup

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // ── 5. Validate mime type (defense-in-depth, magic bytes is the real gate) ──
    const validMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (file.mimetype && !validMimeTypes.includes(file.mimetype)) {
      console.warn(`[UPLOAD] Rejected invalid mime type: ${file.mimetype}`);
      return res.status(400).json({ error: `Invalid file type (${file.mimetype}). Only JPG, PNG, WEBP, and GIF are allowed.` });
    }

    // ── 6. Validate extension ──
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    if (!validExtensions.includes(ext)) {
      return res.status(400).json({ error: 'Invalid file extension.' });
    }

    // ── 7. Validate folder ──
    const validFolders = ['avatars', 'banners', 'playlists', 'uploads'];
    if (!validFolders.includes(folder)) {
      return res.status(400).json({ error: 'Invalid folder' });
    }

    // ── 8. Read arrayBuffer ──
    const uint8Array = new Uint8Array(file.buffer);

    // ── 9. Magic Bytes Validation (the real gate — prevents fake images) ──
    const headerBytes = Array.from(uint8Array.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    let isRealImage = false;
    if (headerBytes.startsWith('FFD8FF')) isRealImage = true; // JPEG
    else if (headerBytes === '89504E47') isRealImage = true;  // PNG
    else if (headerBytes.startsWith('47494638')) isRealImage = true; // GIF (GIF8)
    else if (
      String.fromCharCode(...Array.from(uint8Array.slice(0, 4))) === 'RIFF' &&
      uint8Array.length >= 12 &&
      String.fromCharCode(...Array.from(uint8Array.slice(8, 12))) === 'WEBP'
    ) {
      isRealImage = true; // WEBP
    }

    if (!isRealImage) {
      console.warn(`[SECURITY] User ${user.id} attempted to upload a fake image.`);
      return res.status(400).json({ error: 'Malicious payload detected. Fake image rejected.' });
    }

    // ── 11. Generate unique filename ──
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const fileName = `${folder}/${user.id}_${timestamp}_${randomString}.${ext}`;

    // ── 12. Upload to R2 (BEFORE deleting old file) ──
    const bucketName = process.env.R2_BUCKET_NAME!;
    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: uint8Array,
        ContentType: file.mimetype,
      })
    );

    // ── 13. Delete old file from R2 AFTER upload succeeds ──
    const mapping = FOLDER_TO_DB_COLUMN[folder];

    if (mapping) {
      try {
        let oldUrl: string | null = null;

        if (folder === 'playlists' && playlistId) {
          const { data } = await supabase
            .from(mapping.table)
            .select(mapping.column)
            .eq(mapping.idColumn, playlistId)
            .eq('user_id', user.id)
            .maybeSingle();
          oldUrl = (data as any)?.[mapping.column] || null;
        } else if (folder === 'avatars' || folder === 'banners') {
          const { data } = await supabase
            .from(mapping.table)
            .select(mapping.column)
            .eq(mapping.idColumn, user.id)
            .maybeSingle();
          oldUrl = (data as any)?.[mapping.column] || null;
        }

        if (oldUrl) {
          const oldKey = extractR2Key(oldUrl);
          if (oldKey && oldKey.includes(`/${user.id}_`)) {
            await r2Client.send(
              new DeleteObjectCommand({ Bucket: bucketName, Key: oldKey })
            );
          }
        }
      } catch (deleteErr) {
        console.warn('[UPLOAD] Failed to delete old file:', deleteErr);
      }
    }

    // ── 14. Return public URL ──
    const devUrl = process.env.NEXT_PUBLIC_R2_DEV_URL!;
    const baseUrl = devUrl.endsWith('/') ? devUrl.slice(0, -1) : devUrl;
    const publicUrl = `${baseUrl}/${fileName}`;

    return res.status(200).json({ url: publicUrl });
  } catch (error) {
    console.error('Error uploading file to R2:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
