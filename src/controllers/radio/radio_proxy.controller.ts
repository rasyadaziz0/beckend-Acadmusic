import { Request, Response } from 'express';
import { Readable } from 'stream';
import { safeFetch } from '../../lib/safeFetch';
import { getClientIp } from '../../middleware/rateLimit';

const activeStreams = new Map<string, number>();
const activeHlsRequests = new Map<string, number>();

const MAX_ACTIVE_IP_KEYS = 5000;
const MAX_ACTIVE_STREAMS = 200;
const MAX_HLS_REQUESTS = 500;

let totalActiveStreams = 0;
let totalHlsRequests = 0;

function incrementStream(ip: string, isHls: boolean): boolean {
  const map = isHls ? activeHlsRequests : activeStreams;
  const limit = isHls ? 20 : 5; // Allow more concurrent HLS segment requests (they are short)
  
  if (isHls && totalHlsRequests >= MAX_HLS_REQUESTS) return false;
  if (!isHls && totalActiveStreams >= MAX_ACTIVE_STREAMS) return false;
  
  if (!map.has(ip) && map.size >= MAX_ACTIVE_IP_KEYS) return false;

  const current = map.get(ip) || 0;
  if (current >= limit) return false;
  
  map.set(ip, current + 1);
  if (isHls) totalHlsRequests++;
  else totalActiveStreams++;
  return true;
}

function decrementStream(ip: string, isHls: boolean) {
  const map = isHls ? activeHlsRequests : activeStreams;
  const current = map.get(ip) || 0;
  if (current <= 1) {
    map.delete(ip);
  } else {
    map.set(ip, current - 1);
  }
  
  if (isHls) totalHlsRequests = Math.max(0, totalHlsRequests - 1);
  else totalActiveStreams = Math.max(0, totalActiveStreams - 1);
}

export const getRadioProxy = async (req: Request, res: Response) => {
  const urlParam = req.query.url as string;
  const ip = getClientIp(req);
  
  if (!urlParam) {
    return res.status(400).send('Missing url parameter');
  }

  // Determine if it's likely HLS based on routing hint
  const isLikelyHls = req.query.mode === 'hls';

  if (!incrementStream(ip, isLikelyHls)) {
    return res.status(429).send('Too many concurrent radio streams');
  }

  try {
    const proxyRes = await safeFetch(urlParam, {
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    });

    const contentType = proxyRes.headers.get('content-type') || 'audio/mpeg';
    const isM3U8 = contentType.includes('mpegurl') || contentType.includes('x-mpegURL');

    // If they hinted HLS to get a higher limit, strictly enforce that it actually is HLS
    if (isLikelyHls && !isM3U8) {
       return res.status(403).send('Blocked: HLS mode hinted but content is not HLS');
    }

    if (isM3U8) {
      // For M3U8, we need to enforce a size limit to prevent OOM
      const MAX_M3U8_BYTES = 1 * 1024 * 1024; // 1MB
      let text = '';
      
      if (proxyRes.body) {
        const reader = proxyRes.body.getReader();
        const decoder = new TextDecoder();
        let bytesRead = 0;
        let isM3u8Validated = false;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          bytesRead += value.length;
          if (bytesRead > MAX_M3U8_BYTES) {
            reader.cancel();
            return res.status(413).send('Payload Too Large: M3U8 exceeds 1MB');
          }
          text += decoder.decode(value, { stream: true });

          if (!isM3u8Validated && text.length >= 7) {
            if (!text.trimStart().startsWith('#EXTM3U')) {
              reader.cancel();
              return res.status(403).send('Blocked: Invalid HLS Manifest');
            }
            isM3u8Validated = true;
          }
        }
        text += decoder.decode(); // flush
        
        if (!isM3u8Validated && text.trimStart().startsWith('#EXTM3U')) {
           isM3u8Validated = true;
        }
        if (!isM3u8Validated) {
           return res.status(403).send('Blocked: Invalid HLS Manifest');
        }
      }

      const baseUrl = new URL(urlParam);
      const lines = text.split('\n');
      const host = req.headers.host || 'localhost:3000';
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      
      const rewritten = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        
        let absoluteUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          absoluteUrl = new URL(trimmed, baseUrl).toString();
        }
        
        const proxyUrl = new URL(`${protocol}://${host}/api/radio/proxy`);
        proxyUrl.searchParams.set('url', absoluteUrl);
        proxyUrl.searchParams.set('mode', 'hls');
        return proxyUrl.toString();
      }).join('\n');
      
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(proxyRes.status).send(rewritten);
    }

    // Stream audio — pipe directly to prevent OOM on infinite radio streams
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    
    res.status(proxyRes.status);
    
    if (proxyRes.body) {
      const nodeStream = Readable.fromWeb(proxyRes.body as any);
      const idleTimeoutMs = parseInt(process.env.RADIO_STREAM_IDLE_TIMEOUT_MS || '3600000', 10);
      let timeout: NodeJS.Timeout;

      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          nodeStream.destroy(new Error('Stream idle timeout'));
        }, idleTimeoutMs);
      };

      nodeStream.on('data', () => resetTimeout());
      resetTimeout();

      // Wrap pipe in a promise to properly block the try/finally until stream ends
      await new Promise((resolve, reject) => {
        nodeStream.pipe(res);

        const cleanupAndResolve = () => {
          clearTimeout(timeout);
          nodeStream.destroy();
          resolve(null);
        };

        const cleanupAndReject = (err: any) => {
          clearTimeout(timeout);
          nodeStream.destroy();
          reject(err);
        };

        res.on('finish', cleanupAndResolve);
        res.on('close', cleanupAndResolve);
        req.on('close', cleanupAndResolve);
        req.on('aborted', cleanupAndResolve);

        nodeStream.on('error', cleanupAndReject);
        res.on('error', cleanupAndReject);
      });
      return;
    } else {
      return res.send();
    }
  } catch (err: any) {
    if (err?.message?.startsWith('SSRF blocked')) {
      return res.status(403).send('Blocked: unsafe URL');
    }
    if (!res.headersSent) {
      console.error('Radio proxy error:', err);
      return res.status(500).send('Proxy error');
    }
  } finally {
    decrementStream(ip, isLikelyHls);
  }
};

