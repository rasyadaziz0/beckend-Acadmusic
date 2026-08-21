import { Request, Response } from 'express';
import { getYtMusicClient } from '../../lib/ytmusic';

type YoutubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
  };
};

function getYoutubeApiKeys() {
  return [
    process.env.YOUTUBE_API_KEY1,
    process.env.YOUTUBE_API_KEY2,
    process.env.YOUTUBE_API_KEY3,
    process.env.YOUTUBE_API_KEY,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
}

function normalizeText(text: string) {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function scoreFallbackCandidate(item: YoutubeSearchItem, title: string, artist: string) {
  const rawTitle = item.snippet?.title ?? '';
  const rawDescription = item.snippet?.description ?? '';
  const rawChannel = item.snippet?.channelTitle ?? '';
  const text = normalizeText(`${rawTitle} ${rawDescription} ${rawChannel}`);

  const hardBlockTerms = ['vevo', 'official', 'topic', '- topic', 'provided to youtube by'];
  if (hardBlockTerms.some((term) => text.includes(` ${normalizeText(term).trim()} `))) {
    return -999;
  }

  let score = 0;
  const preferredTerms = ['audio', 'lyric', 'lyrics'];
  preferredTerms.forEach((term) => {
    if (text.includes(` ${term} `)) score += 8;
  });

  const noisyTerms = ['live', 'concert', 'karaoke', 'cover', 'reaction', 'teaser', 'trailer'];
  noisyTerms.forEach((term) => {
    if (text.includes(` ${term} `)) score -= 7;
  });

  const titleNormalized = normalizeText(title).trim();
  const artistNormalized = normalizeText(artist).trim();
  if (titleNormalized && text.includes(` ${titleNormalized} `)) score += 25;
  if (artistNormalized && text.includes(` ${artistNormalized} `)) score += 15;

  return score;
}

async function resolveFallbackVideoId(title: string, artist: string): Promise<string | null> {
  const apiKeys = getYoutubeApiKeys();
  if (apiKeys.length === 0) return null;

  const query = `${title} ${artist} audio lyric`.trim();

  for (const key of apiKeys) {
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=id,snippet&maxResults=12&type=video&videoCategoryId=10` +
      `&q=${encodeURIComponent(query)}&key=${key}`;

    let response;
    try {
      response = await fetch(searchUrl, { 
        cache: 'no-store',
        signal: AbortSignal.timeout(10000) 
      });
    } catch (err) {
      continue;
    }
    
    if (!response.ok) continue;

    const payload = (await response.json()) as { items?: YoutubeSearchItem[] };
    const items = Array.isArray(payload.items) ? payload.items : [];
    const ranked = items
      .map((item) => ({ item, score: scoreFallbackCandidate(item, title, artist) }))
      .filter((entry) => entry.score > -999)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0]?.item?.id?.videoId ?? items[0]?.id?.videoId;
    if (best) return best;
  }

  return null;
}

const RESOLVE_CACHE = new Map<string, { data: any; expiry: number }>();
const IN_FLIGHT_RESOLVES = new Map<string, Promise<any>>();
const MAX_CACHE_SIZE = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Periodic cache housekeeping
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of RESOLVE_CACHE.entries()) {
    if (now > value.expiry) {
      RESOLVE_CACHE.delete(key);
    }
  }
}, 10 * 60 * 1000); // 10 mins

// Circuit Breaker State
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN';
let circuitState: CircuitState = 'CLOSED';
let consecutiveFailures = 0;
let isProbing = false;
let circuitOpenTimeout: NodeJS.Timeout | null = null;
const MAX_FAILURES = 3;
const COOLDOWN_MS = 30000;

function handleUpstreamFailure() {
  if (circuitState === 'CLOSED') {
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_FAILURES) {
      circuitState = 'OPEN';
      console.warn('Circuit Breaker: OPEN (Audio Resolve)');
      circuitOpenTimeout = setTimeout(() => {
        circuitState = 'HALF-OPEN';
        console.warn('Circuit Breaker: HALF-OPEN (Audio Resolve)');
      }, COOLDOWN_MS);
    }
  } else if (circuitState === 'HALF-OPEN') {
    isProbing = false;
    circuitState = 'OPEN';
    console.warn('Circuit Breaker: Probe failed, returning to OPEN');
    circuitOpenTimeout = setTimeout(() => {
      circuitState = 'HALF-OPEN';
      console.warn('Circuit Breaker: HALF-OPEN (Audio Resolve)');
    }, COOLDOWN_MS);
  }
}

function handleUpstreamSuccess() {
  if (circuitState === 'HALF-OPEN' || circuitState === 'CLOSED') {
    circuitState = 'CLOSED';
    consecutiveFailures = 0;
    isProbing = false;
    if (circuitOpenTimeout) {
      clearTimeout(circuitOpenTimeout);
      circuitOpenTimeout = null;
    }
  }
}

function getNormalizedCacheKey(title: string, artist: string, fallback: boolean, duration: number): string {
  const normTitle = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normArtist = (artist || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${normTitle}|${normArtist}|${fallback ? '1' : '0'}|${duration}`;
}

function getFromCache(key: string) {
  const cached = RESOLVE_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiry) {
    RESOLVE_CACHE.delete(key);
    return null;
  }
  // LRU behavior: bump to end
  RESOLVE_CACHE.delete(key);
  RESOLVE_CACHE.set(key, cached);
  return cached.data;
}

function setInCache(key: string, data: any, ttlMs: number = CACHE_TTL_MS) {
  if (RESOLVE_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = RESOLVE_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      RESOLVE_CACHE.delete(oldestKey);
    }
  }
  RESOLVE_CACHE.set(key, { data, expiry: Date.now() + ttlMs });
}

export const getAudioResolve = async (req: Request, res: Response) => {
  const title = req.query['title'] as string;
  const artist = req.query['artist'] as string;
  const fallback = req.query['fallback'] === '1';

  if (!title?.trim()) {
    return res.status(400).json({ error: 'Missing title parameter' });
  }

  const targetDuration = parseInt((req.query['duration'] as string) || '0', 10);
  const cacheKey = getNormalizedCacheKey(title, artist, fallback, targetDuration);

  // 1. Check cache
  const cached = getFromCache(cacheKey);
  if (cached) {
    if (cached.status && cached.error) {
      return res.status(cached.status).json(cached);
    }
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    return res.json(cached);
  }

  // Circuit breaker gate
  if (circuitState === 'OPEN') {
    return res.status(503).json({ error: 'Service Unavailable: Circuit Breaker OPEN' });
  }
  if (circuitState === 'HALF-OPEN') {
    if (isProbing) {
      return res.status(503).json({ error: 'Service Unavailable: Circuit Breaker HALF-OPEN (probing)' });
    }
    isProbing = true;
  }

  // 2. Check in-flight resolves (deduplication)
  if (IN_FLIGHT_RESOLVES.has(cacheKey)) {
    try {
      const result = await IN_FLIGHT_RESOLVES.get(cacheKey);
      res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
      return res.json(result);
    } catch (err: any) {
      return res.status(err.status || 500).json({ error: err.message || 'Failed to resolve audio' });
    }
  }

  const resolveLogic = async () => {
    // ── Fallback path: YouTube Data API v3 ──────────────────────────
    if (fallback) {
      const fallbackVideoId = await resolveFallbackVideoId(title.trim(), artist?.trim() ?? '');
      if (!fallbackVideoId) {
        const err: any = new Error('No fallback video found');
        err.status = 404;
        throw err;
      }
      return { videoId: fallbackVideoId, source: 'fallback' };
    }

    // ── Primary path: ytmusic-api (lightweight, Edge-safe) ──────────
    const query = artist?.trim()
      ? `${title.trim()} ${artist.trim()}`
      : title.trim();

    const client = await getYtMusicClient();
    const searchResults = await client.searchSongs(query);

    if (!searchResults || searchResults.length === 0) {
      const err: any = new Error('No song results found on YouTube Music');
      err.status = 404;
      throw err;
    }

    // Filter and score results
    const targetTitle = normalizeText(title).trim();
    const targetArtist = normalizeText(artist || '').trim();

    const rankedSongs = searchResults.map((song: any, index: number) => {
      let score = 100 - index * 5;
      const songTitle = normalizeText(song.name || '').trim();
      const songArtist = normalizeText(song.artist?.name || '').trim();

      if (songTitle && targetTitle && (songTitle.includes(targetTitle) || targetTitle.includes(songTitle))) score += 20;
      if (songArtist && targetArtist && (songArtist.includes(targetArtist) || targetArtist.includes(songArtist))) score += 20;

      // Penalize live and cover if they are not in the target title
      if (!targetTitle.includes('live') && songTitle.includes('live')) score -= 30;
      if (!targetTitle.includes('cover') && songTitle.includes('cover')) score -= 30;
      if (!targetTitle.includes('karaoke') && songTitle.includes('karaoke')) score -= 30;
      if (!targetTitle.includes('remix') && songTitle.includes('remix')) score -= 20;

      // Penalize duration mismatches
      if (targetDuration > 0 && typeof song.duration === 'number' && song.duration > 0) {
        const diff = Math.abs(song.duration - targetDuration);
        if (diff > 15) {
          score -= diff;
        } else {
          score += 10;
        }
      }

      return { song, score };
    }).sort((a: any, b: any) => b.score - a.score);

    const bestMatch = rankedSongs[0].song;

    if (!bestMatch?.videoId) {
      const err: any = new Error('Invalid search result format');
      err.status = 404;
      throw err;
    }

    return {
      videoId: bestMatch.videoId,
      title: bestMatch.name,
      artist: bestMatch.artist?.name,
      duration: bestMatch.duration,
    };
  };

  const resolvePromise = resolveLogic();
  IN_FLIGHT_RESOLVES.set(cacheKey, resolvePromise);

  try {
    const result = await resolvePromise;
    setInCache(cacheKey, result);
    IN_FLIGHT_RESOLVES.delete(cacheKey);
    handleUpstreamSuccess();
    
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    return res.json(result);
  } catch (error: any) {
    IN_FLIGHT_RESOLVES.delete(cacheKey);
    
    const isOutage = error.status >= 500 || error.code === 'ECONNRESET' || error.message?.includes('timeout') || error.name === 'TimeoutError';
    
    if (isOutage) {
       handleUpstreamFailure();
    } else if (circuitState === 'HALF-OPEN') {
       // if we probed and it was a 404/429, we don't count it as a failure since the API is alive
       handleUpstreamSuccess();
    }
    
    // Negative caching for "Not Found"
    if (error.status === 404) {
      setInCache(cacheKey, { error: error.message || 'Not found', status: 404 }, 60_000);
    }
    
    console.error('Audio resolve failed:', getErrorMessage(error));
    return res.status(error.status || 500).json({ error: error.message || 'Failed to resolve audio' });
  }
};
