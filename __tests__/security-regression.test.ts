import assert from 'assert';
import { safeFetch } from '../src/lib/safeFetch';

async function runTests() {
  console.log('Running Security Regression Tests...\n');
  let passed = 0;
  let failed = 0;

  function runTest(name: string, testFn: () => Promise<void> | void) {
    return async () => {
      try {
        await testFn();
        console.log(`✅ PASS: ${name}`);
        passed++;
      } catch (err: any) {
        console.error(`❌ FAIL: ${name}`);
        console.error(`   ${err.message}`);
        failed++;
      }
    };
  }

  const tests = [
    runTest('SSRF Protection: Block localhost (127.0.0.1)', async () => {
      try {
        await safeFetch('http://127.0.0.1:3000');
        assert.fail('Should have thrown an SSRF blocked error');
      } catch (err: any) {
        const msg = err.message + (err.cause?.message ? ' ' + err.cause.message : '');
        assert.ok(msg.includes('SSRF blocked'), `Unexpected error: ${msg}`);
      }
    }),

    runTest('SSRF Protection: Block metadata IP (169.254.169.254)', async () => {
      try {
        await safeFetch('http://169.254.169.254/latest/meta-data/');
        assert.fail('Should have thrown an SSRF blocked error');
      } catch (err: any) {
        const msg = err.message + (err.cause?.message ? ' ' + err.cause.message : '');
        assert.ok(msg.includes('SSRF blocked'), `Unexpected error: ${msg}`);
      }
    }),

    runTest('SSRF Protection: Block local network (192.168.1.1)', async () => {
      try {
        await safeFetch('http://192.168.1.1');
        assert.fail('Should have thrown an SSRF blocked error');
      } catch (err: any) {
        assert.ok(err.message.includes('SSRF blocked'), `Unexpected error: ${err.message}`);
      }
    }),

    runTest('SSRF Protection: Allow public URL (example.com)', async () => {
      try {
        const res = await safeFetch('https://example.com');
        assert.ok(res.ok, 'Should successfully fetch example.com');
      } catch (err: any) {
        assert.fail(`Should not block public IPs. Error: ${err.message}`);
      }
    }),
    
    runTest('Rate Limiter: Local Fallback Enforces Limits', async () => {
      const { rateLimiter } = await import('../src/middleware/rateLimit');
      
      const config = {
        limit: 2,
        windowMs: 5000,
        keyPrefix: 'testGuard',
        useLocalOnly: true, // Force local memory test
      };
      
      const middleware = rateLimiter(config);
      
      let nextCount = 0;
      let rateLimitHit = false;
      
      const createMockReq = (ip: string) => ({
        ip,
        socket: { remoteAddress: ip },
        headers: {},
      } as any);

      const createMockRes = () => {
        const res: any = {
          headers: {},
          setHeader(key: string, val: any) { this.headers[key] = val; },
          status(code: number) {
            if (code === 429) rateLimitHit = true;
            return this;
          },
          json() { return this; }
        };
        return res;
      };

      const next = () => { nextCount++; };

      const req = createMockReq('10.0.0.1');
      
      // Request 1
      await middleware(req, createMockRes(), next);
      assert.strictEqual(nextCount, 1, 'First request should pass');
      
      // Request 2
      await middleware(req, createMockRes(), next);
      assert.strictEqual(nextCount, 2, 'Second request should pass');
      
      // Request 3 - should fail
      await middleware(req, createMockRes(), next);
      assert.strictEqual(nextCount, 2, 'Third request should NOT pass');
      assert.ok(rateLimitHit, 'Rate limit should be triggered (429)');
    }),

    runTest('Proxy: Block unsupported Content-Type (HTML)', async () => {
      const { getProxy } = await import('../src/controllers/misc/proxy.controller');
      
      let status = 0;
      let body: any = null;
      
      const req: any = {
        query: { url: 'https://example.com' }, // returns text/html
        headers: {},
      };
      
      const res: any = {
        setHeader() {},
        status(c: number) { status = c; return this; },
        json(b: any) { body = b; return this; }
      };

      await getProxy(req, res);
      
      assert.strictEqual(status, 403, 'Should block non-media content types');
      assert.ok(body.error.includes('unsupported content type'), 'Should contain unsupported content error');
    }),

    runTest('Radio Proxy: Block fake HLS hint', async () => {
      const { getRadioProxy } = await import('../src/controllers/radio/radio_proxy.controller');
      
      let status = 0;
      let body = '';
      
      const req: any = {
        query: { url: 'https://example.com', mode: 'hls' }, // mode=hls hint, but returns text/html
        headers: {},
        socket: { remoteAddress: '10.0.0.1' },
      };
      
      const res: any = {
        setHeader() {},
        status(c: number) { status = c; return this; },
        send(b: string) { body = b; return this; }
      };

      await getRadioProxy(req, res);
      
      assert.strictEqual(status, 403, 'Should reject non-HLS content when mode=hls is provided');
      assert.ok(body.includes('content is not HLS'), 'Should contain fake HLS error message');
    }),
  ];

  for (const test of tests) {
    await test();
  }

  console.log(`\nTests Completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
