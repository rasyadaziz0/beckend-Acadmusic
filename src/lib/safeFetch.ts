import { Agent, fetch as undiciFetch } from 'undici';
import dns from 'dns';
import net from 'net';


import * as ipaddr from 'ipaddr.js';

// Ranges that must never be reached via SSRF
function isPrivateIp(ip: string): boolean {
  try {
    let addr = ipaddr.parse(ip);
    if (addr.kind() === 'ipv6') {
      const v6Addr = addr as ipaddr.IPv6;
      if (v6Addr.isIPv4MappedAddress()) {
        addr = v6Addr.toIPv4Address();
      }
    }
    const range = addr.range();
    
    // Only 'unicast' is generally a safe public IP.
    // We explicitly block all these special ranges.
    if (range !== 'unicast') {
      return true;
    }
    
    return false;
  } catch (e) {
    // If parsing fails, fail closed (block it)
    return true;
  }
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
    if (parsed.hostname.endsWith('cadhost.sbs')) {
      throw new Error(`SSRF blocked: loopback hostname ${parsed.hostname}`);
    }

    // Undici skips DNS lookup for IP addresses, so we must manually check them
    if (net.isIP(parsed.hostname) && isPrivateIp(parsed.hostname)) {
      throw new Error(`SSRF blocked: private IP ${parsed.hostname}`);
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
