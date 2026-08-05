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

    const response = await fetch(searchUrl, { cache: 'no-store' });
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

export const getAudioResolve = async (req: Request, res: Response) => {
  const title = req.query['title'] as string;
  const artist = req.query['artist'] as string;
  const fallback = req.query['fallback'] === '1';

  if (!title?.trim()) {
    return res.status(400).json({ error: 'Missing title parameter' });
  }

  // ── Fallback path: YouTube Data API v3 ──────────────────────────
  if (fallback) {
    try {
      const fallbackVideoId = await resolveFallbackVideoId(title.trim(), artist?.trim() ?? '');
      if (!fallbackVideoId) {
        return res.status(404).json({ error: 'No fallback video found' });
      }

      res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
      return res.json({ videoId: fallbackVideoId, source: 'fallback' });
    } catch (error: unknown) {
      console.error('Fallback resolve failed:', getErrorMessage(error));
      return res.status(500).json({ error: 'Failed to resolve fallback video' });
    }
  }

  // ── Primary path: ytmusic-api (lightweight, Edge-safe) ──────────
  const query = artist?.trim()
    ? `${title.trim()} ${artist.trim()}`
    : title.trim();

  try {
    const client = await getYtMusicClient();
    const searchResults = await client.searchSongs(query);

    if (!searchResults || searchResults.length === 0) {
      return res.status(404).json({ error: 'No song results found on YouTube Music' });
    }

    // Filter and score results
    const targetTitle = normalizeText(title).trim();
    const targetArtist = normalizeText(artist || '').trim();
    const targetDuration = parseInt((req.query['duration'] as string) || '0', 10);

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
      return res.status(404).json({ error: 'Invalid search result format' });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    return res.json({
      videoId: bestMatch.videoId,
      title: bestMatch.name,
      artist: bestMatch.artist?.name,
      duration: bestMatch.duration,
    });

  } catch (error: unknown) {
    console.error('Audio resolve failed with ytmusic-api:', getErrorMessage(error));

    return res.status(500).json({ error: 'Failed to resolve audio' });
  }
};
