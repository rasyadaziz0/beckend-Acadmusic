import { Request, Response } from 'express';

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,        // Loopback
  /^10\.\d+\.\d+\.\d+$/,          // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,   // RFC 1918
  /^192\.168\.\d+\.\d+$/,         // RFC 1918
  /^169\.254\.\d+\.\d+$/,         // Link-local / AWS metadata
  /^0\.0\.0\.0$/,
  /^\[::1?\]$/,                    // IPv6 loopback
  /^metadata\.google\.internal$/i,
  /^metadata\.internal$/i,
];

function isUrlSafe(raw: string): { safe: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { safe: false, error: 'Invalid URL format' };
  }

  // Only allow http and https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, error: 'Only http/https URLs are allowed' };
  }

  // Block private/reserved hostnames
  const hostname = parsed.hostname;
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(hostname))) {
    return { safe: false, error: 'Blocked hostname' };
  }

  // Block any URL with credentials embedded (user:pass@host)
  if (parsed.username || parsed.password) {
    return { safe: false, error: 'URLs with credentials are not allowed' };
  }

  return { safe: true };
}

export const getRadioMetadata = async (req: Request, res: Response) => {
const streamUrl = (req.query['url'] as string);
if (!streamUrl) {
return res.status(400).json({ error: 'Missing url parameter' });
}

// SSRF guard — validate URL before fetching
const urlCheck = isUrlSafe(streamUrl);
if (!urlCheck.safe) {
return res.status(400).json({ error: urlCheck.error });
}

try {
// Request the stream with Icy-MetaData header to ask for inline metadata
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8000);

const fetchRes = await fetch(streamUrl, {
  headers: {
    'Icy-MetaData': '1',
    'User-Agent': 'Mozilla/5.0 (compatible; AcadMusicRadio/1.0)',
  },
  signal: controller.signal,
});

clearTimeout(timeout);

// Check for icy-metaint header — this tells us the interval between metadata blocks
const metaint = parseInt(fetchRes.headers.get('icy-metaint') || '0', 10);

if (!metaint || !fetchRes.body) {
  // No metadata support — try to get station name from icy-name header
  const icyName = fetchRes.headers.get('icy-name') || '';
  // Abort the stream since we only needed the headers
  controller.abort();
  return res.status(200).json({
    title: icyName || null,
    station: icyName || null,
  });
}

// Read just enough of the stream to get the first metadata block
const reader = fetchRes.body.getReader();
let bytesRead = 0;
const chunks: Uint8Array[] = [];

// Read until we've passed the first metaint boundary + some metadata
const targetBytes = metaint + 4096; // metaint bytes of audio + up to 4KB of metadata
while (bytesRead < targetBytes) {
  const { done, value } = await reader.read();
  if (done || !value) break;
  chunks.push(value);
  bytesRead += value.length;
}

// Cancel the stream — we have what we need
reader.cancel().catch(() => {});
controller.abort();

// Combine all chunks
const combined = new Uint8Array(bytesRead);
let offset = 0;
for (const chunk of chunks) {
  combined.set(chunk, offset);
  offset += chunk.length;
}

// The metadata block starts at `metaint` bytes
if (combined.length <= metaint) {
  return res.status(200).json({ title: null, station: null });
}

// First byte after metaint is the length indicator (multiply by 16 for actual length)
const metaLength = combined[metaint] * 16;
if (metaLength === 0) {
  return res.status(200).json({ title: null, station: null });
}

// Extract the metadata string
const metaStart = metaint + 1;
const metaEnd = Math.min(metaStart + metaLength, combined.length);
const metaBytes = combined.slice(metaStart, metaEnd);
const metaString = new TextDecoder('utf-8').decode(metaBytes);

// Parse StreamTitle from the metadata string
// Format is typically: StreamTitle='Artist - Title';StreamUrl='...';
const titleMatch = metaString.match(/StreamTitle='([^']*)'/);
const title = titleMatch?.[1]?.trim() || null;

return res.status(200).json({
  title,
  raw: metaString.replace(/\0+$/, ''),
});
} catch (err) {
// If fetch times out or stream is unavailable, fail gracefully
if (err instanceof DOMException && err.name === 'AbortError') {
  return res.status(500).json({ title: null, error: 'Stream timeout' });
}
console.error('Radio metadata fetch error:', err);
return res.status(500).json({ title: null, error: 'Failed to fetch metadata' });
}
};

