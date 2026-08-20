import { Request, Response } from 'express';
import { UploadOrchestrator } from '../../services/upload/UploadOrchestrator';

const orchestrator = new UploadOrchestrator();

export const postPresign = async (req: Request, res: Response) => {
  try {
    const authReq = req as any;
    const user = authReq.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { folder, extension, contentType } = req.body;

    if (!folder || !extension || !contentType) {
      return res.status(400).json({ error: 'Missing required fields: folder, extension, contentType' });
    }

    const result = await orchestrator.presign({
      userId: user.id,
      folder,
      extension,
      contentType,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('[UPLOAD PRESIGN] Error:', error);
    const message = error.message || 'Internal Server Error';
    const status = message.includes('Invalid') || message.includes('Unsupported') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
};

export const postVerify = async (req: Request, res: Response) => {
  try {
    const authReq = req as any;
    const user = authReq.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { pendingKey, folder, playlistId } = req.body;

    if (!pendingKey || !folder) {
      return res.status(400).json({ error: 'Missing required fields: pendingKey, folder' });
    }

    const authorization = req.headers.authorization ?? '';
    const supabaseToken = authorization.replace(/^Bearer\s/i, '');

    if (!supabaseToken) {
      return res.status(401).json({ error: 'Missing auth token' });
    }

    const result = await orchestrator.verify({
      userId: user.id,
      pendingKey,
      folder,
      playlistId,
      supabaseToken,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('[UPLOAD VERIFY] Error:', error);
    const message = error.message || 'Internal Server Error';
    const status = message.includes('Malicious') || message.includes('Invalid') || message.includes('Unauthorized') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
};
