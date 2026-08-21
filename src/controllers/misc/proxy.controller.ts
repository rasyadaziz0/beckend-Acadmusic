import { Request, Response } from 'express';
import { Readable } from 'stream';
import { safeFetch } from '../../lib/safeFetch';

export const getProxy = async (req: Request, res: Response) => {
  try {
    const imageUrl = req.query.url as string;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    // safeFetch validates DNS at connection time & follows up to 3 redirects safely
    const response = await safeFetch(imageUrl, { maxRedirects: 3 });

    if (!response.ok) {
      return res.status(400).json({ error: 'Failed to fetch image' });
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    
    // Security: Only allow specific safe image and audio mime types
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/aac',
      'audio/ogg',
      'audio/wav',
      'audio/flac'
    ];

    if (!allowedTypes.some(type => contentType.includes(type))) {
      return res.status(403).json({ error: 'Blocked: unsupported content type' });
    }
    
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB
    const contentLengthStr = response.headers.get('content-length');
    if (contentLengthStr) {
      const contentLength = parseInt(contentLengthStr, 10);
      if (contentLength > MAX_BYTES) {
        return res.status(413).json({ error: 'Payload Too Large: Exceeds 10MB' });
      }
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    if (response.body) {
      const MAX_BYTES = 10 * 1024 * 1024; // 10MB
      let bytesRead = 0;
      
      const nodeStream = Readable.fromWeb(response.body as any);
      
      nodeStream.on('data', (chunk) => {
        bytesRead += chunk.length;
        if (bytesRead > MAX_BYTES) {
          nodeStream.destroy(new Error('Exceeded 10MB byte limit'));
        }
      });
      
      nodeStream.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        } else {
          res.end();
        }
      });
      
      nodeStream.pipe(res);
      
      req.on('close', () => {
        nodeStream.destroy();
      });
      
      return; // Handled by stream
    } else {
      return res.status(200).send(Buffer.from([]));
    }
  } catch (error: any) {
    if (error?.message?.startsWith('SSRF blocked')) {
      return res.status(403).json({ error: 'Blocked: unsafe URL' });
    }
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

