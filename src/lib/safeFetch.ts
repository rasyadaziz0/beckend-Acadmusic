import { Agent, fetch as undiciFetch } from 'undici';
import dns from 'dns';
import net from 'net';

const VPS_PUBLIC_IP = process.env.VPS_PUBLIC_IP || '';

// Ranges that must never be reached via SSRF
function isPrivateIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1 → 127.0.0.1)
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (link-local, AWS metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (normalized === '0.0.0.0') return true;
    // VPS own public IP (loop prevention)
    if (VPS_PUBLIC_IP && normalized === VPS_PUBLIC_IP) return true;
    return false;
  }

  if (net.isIPv6(normalized)) {
    const lower = normalized.toLowerCase();
    // ::1, fc00::/7, fe80::/10
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
    return false;
  }

  return false;
}

// Custom undici Agent that validates DNS at connection time
const safeAgent = new Agent({
  connect: {
    lookup: (hostname: string, options: any, callback: any) => {
      dns.lookup(hostname, options, (err, address: any, family) => {
        if (err) return callback(err, address, family);
        
        const list = Array.isArray(address) ? address.map(a => a.address) : [address];
        const bad = list.find(isPrivateIp);
        
        if (bad) {
          return callback(
            new Error(`SSRF blocked: ${hostname} resolved to private IP ${bad}`),
            address,
            family
          );
        }
        callback(null, address, family);
      });
    },
  },
});

export interface SafeFetchOptions {
  maxRedirects?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * SSRF-safe fetch that:
 * 1. Validates DNS at connection time (anti-TOCTOU)
 * 2. Follows redirects manually up to maxRedirects hops, validating each hop
 * 3. Blocks private IPs, loopback, link-local, and VPS own IP
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const { maxRedirects = 3, headers = {}, signal } = options;

  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Validate scheme
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`SSRF blocked: unsupported protocol ${parsed.protocol}`);
    }

    const response = await undiciFetch(currentUrl, {
      dispatcher: safeAgent,
      redirect: 'manual',
      headers,
      signal,
    });

    // If not a redirect, return the response
    const status = response.status;
    if (status < 300 || status >= 400 || !response.headers.get('location')) {
      return response as unknown as Response;
    }

    // Follow redirect — resolve relative Location
    const location = response.headers.get('location')!;
    currentUrl = new URL(location, currentUrl).toString();

    // Consume body to free resources
    await response.arrayBuffer().catch(() => {});
  }

  throw new Error(`SSRF blocked: too many redirects (>${maxRedirects})`);
}
