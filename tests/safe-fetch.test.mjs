import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SafeFetchError,
  UnsafeUrlError,
  assertPublicHttpUrl,
  createSafeFetch,
  isPublicIp,
} from '../lib/network/safe-fetch.mjs';
import { installPlaywrightNetworkGuard } from '../lib/network/playwright-guard.mjs';

const publicResolver = async () => [
  { address: '8.8.8.8', family: 4 },
  { address: '2001:4860:4860::8888', family: 6 },
];

test('classifies public and non-public IPv4 ranges', () => {
  assert.equal(isPublicIp('8.8.8.8'), true);
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assert.equal(isPublicIp(address), false, address);
  }
});

test('classifies public and non-public IPv6 ranges', () => {
  assert.equal(isPublicIp('2001:4860:4860::8888'), true);
  for (const address of [
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '64:ff9b::1',
    '100::1',
    '2001:db8::1',
    '2002::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ]) {
    assert.equal(isPublicIp(address), false, address);
  }
});

test('rejects dangerous protocols and embedded credentials', async () => {
  for (const url of [
    'file:///etc/passwd',
    'data:text/plain,secret',
    'ftp://example.com/file',
    'https://user:password@example.com/',
  ]) {
    await assert.rejects(
      assertPublicHttpUrl(url, { resolver: publicResolver }),
      UnsafeUrlError,
      url,
    );
  }
});

test('rejects localhost names, nonstandard ports and private literals', async () => {
  for (const url of [
    'http://localhost/',
    'https://service.internal/',
    'https://example.com:8443/',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
  ]) {
    await assert.rejects(
      assertPublicHttpUrl(url, { resolver: publicResolver }),
      UnsafeUrlError,
      url,
    );
  }
});

test('normalizes alternative IPv4 notation before classification', async () => {
  await assert.rejects(
    assertPublicHttpUrl('http://2130706433/'),
    (error) => error instanceof UnsafeUrlError && error.code === 'NON_PUBLIC_IP',
  );
});

test('rejects any mixed public and private DNS answer', async () => {
  await assert.rejects(
    assertPublicHttpUrl('https://mixed.example/', {
      resolver: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    }),
    (error) => error instanceof UnsafeUrlError && error.code === 'NON_PUBLIC_IP',
  );
});

test('accepts a public HTTPS host and returns the pinned address', async () => {
  const result = await assertPublicHttpUrl('https://jobs.example/', {
    resolver: publicResolver,
    requireHttps: true,
  });
  assert.equal(result.address, '8.8.8.8');
  assert.equal(result.family, 4);
  assert.equal(result.port, 443);
});

test('enforces exact and wildcard host allowlists', async () => {
  await assertPublicHttpUrl('https://api.example.com/', {
    resolver: publicResolver,
    allowedHosts: ['api.example.com'],
  });
  await assertPublicHttpUrl('https://jobs.example.com/', {
    resolver: publicResolver,
    allowedHosts: ['*.example.com'],
  });
  await assert.rejects(
    assertPublicHttpUrl('https://attacker.example/', {
      resolver: publicResolver,
      allowedHosts: ['api.example.com'],
    }),
    (error) => error.code === 'HOST_NOT_ALLOWED',
  );
});

test('safeFetch pins the validated address into the transport', async () => {
  const calls = [];
  const safeFetch = createSafeFetch({
    resolver: publicResolver,
    requester: async (url, options) => {
      calls.push({ url: String(url), ...options });
      return response(200, 'ok', { 'content-type': 'text/plain' });
    },
  });
  const result = await safeFetch('https://jobs.example/path');
  assert.equal(await result.text(), 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].address, '8.8.8.8');
  assert.equal(calls[0].family, 4);
});

test('safeFetch revalidates redirects and blocks a redirect to private DNS', async () => {
  const calls = [];
  const safeFetch = createSafeFetch({
    resolver: async (hostname) => (
      hostname === 'private.example'
        ? [{ address: '10.0.0.2', family: 4 }]
        : [{ address: '8.8.8.8', family: 4 }]
    ),
    requester: async (url) => {
      calls.push(String(url));
      return response(302, '', { location: 'https://private.example/admin' });
    },
  });
  await assert.rejects(
    safeFetch('https://public.example/start'),
    (error) => error instanceof UnsafeUrlError && error.code === 'NON_PUBLIC_IP',
  );
  assert.deepEqual(calls, ['https://public.example/start']);
});

test('safeFetch follows bounded public redirects', async () => {
  const calls = [];
  const safeFetch = createSafeFetch({
    resolver: publicResolver,
    requester: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return response(302, '', { location: 'https://b.example/final' });
      return response(200, 'done');
    },
  });
  const result = await safeFetch('https://a.example/start', { maxRedirects: 2 });
  assert.equal(result.redirected, true);
  assert.equal(result.url, 'https://b.example/final');
  assert.equal(await result.text(), 'done');
});

test('safeFetch blocks HTTPS-to-HTTP downgrade redirects by default', async () => {
  const safeFetch = createSafeFetch({
    resolver: publicResolver,
    requester: async () => response(302, '', { location: 'http://jobs.example/final' }),
  });
  await assert.rejects(
    safeFetch('https://jobs.example/start'),
    (error) => error.code === 'HTTPS_DOWNGRADE_BLOCKED',
  );
});

test('safeFetch strips sensitive headers on cross-origin redirects', async () => {
  const calls = [];
  const safeFetch = createSafeFetch({
    resolver: publicResolver,
    requester: async (url, options) => {
      calls.push({ url: String(url), headers: new Headers(options.headers) });
      if (calls.length === 1) return response(302, '', { location: 'https://other.example/final' });
      return response(200, 'done');
    },
  });
  await safeFetch('https://api.example/start', {
    headers: {
      authorization: 'Bearer synthetic-test-value',
      'x-browser-use-api-key': 'synthetic-test-value',
    },
  });
  assert.equal(calls[0].headers.has('authorization'), true);
  assert.equal(calls[1].headers.has('authorization'), false);
  assert.equal(calls[1].headers.has('x-browser-use-api-key'), false);
});

test('safeFetch caps redirects, request bodies and response bodies', async () => {
  const redirecting = createSafeFetch({
    resolver: publicResolver,
    requester: async () => response(302, '', { location: 'https://loop.example/' }),
  });
  await assert.rejects(
    redirecting('https://loop.example/', { maxRedirects: 1 }),
    (error) => error instanceof SafeFetchError && error.code === 'TOO_MANY_REDIRECTS',
  );

  const successful = createSafeFetch({
    resolver: publicResolver,
    requester: async () => response(200, '12345'),
  });
  await assert.rejects(
    successful('https://jobs.example/', { maxResponseBytes: 4 }),
    (error) => error.code === 'RESPONSE_TOO_LARGE',
  );
  await assert.rejects(
    successful('https://jobs.example/', {
      method: 'POST',
      body: '12345',
      maxRequestBytes: 4,
    }),
    (error) => error.code === 'REQUEST_TOO_LARGE',
  );
});

test('safeFetch can require HTTPS and rejects caller-controlled Host headers', async () => {
  const safeFetch = createSafeFetch({
    resolver: publicResolver,
    requester: async () => response(200, 'ok'),
  });
  await assert.rejects(
    safeFetch('http://jobs.example/', { requireHttps: true }),
    (error) => error.code === 'HTTPS_REQUIRED',
  );
  await assert.rejects(
    safeFetch('https://jobs.example/', { headers: { host: 'internal.example' } }),
    (error) => error.code === 'HOST_HEADER_BLOCKED',
  );
  await assert.rejects(
    safeFetch('https://jobs.example/', { method: 'CONNECT' }),
    (error) => error.code === 'METHOD_NOT_ALLOWED',
  );
  await assert.rejects(
    safeFetch('https://jobs.example/', { method: 'GET', body: 'unexpected' }),
    (error) => error.code === 'BODY_NOT_ALLOWED',
  );
});

test('safe response body follows single-consumption semantics', async () => {
  const safeFetch = createSafeFetch({
    resolver: publicResolver,
    requester: async () => response(200, '{"ok":true}', { 'content-type': 'application/json' }),
  });
  const result = await safeFetch('https://jobs.example/');
  assert.deepEqual(await result.json(), { ok: true });
  await assert.rejects(result.text(), TypeError);
});

test('Playwright guard blocks unsafe requests and optional resource types', async () => {
  let handler;
  let webSocketHandler;
  const context = {
    async route(_pattern, callback) {
      handler = callback;
    },
    async routeWebSocket(_pattern, callback) {
      webSocketHandler = callback;
    },
  };
  await installPlaywrightNetworkGuard(context, {
    resolver: publicResolver,
    blockedResourceTypes: ['image'],
  });

  const image = fakeRoute('https://jobs.example/logo.png', 'image');
  await handler(image);
  assert.equal(image.action, 'abort');

  const privateRequest = fakeRoute('http://127.0.0.1/admin', 'document');
  await handler(privateRequest);
  assert.equal(privateRequest.action, 'abort');

  const dataDocument = fakeRoute('data:text/html,unsafe-navigation', 'document');
  await handler(dataDocument);
  assert.equal(dataDocument.action, 'abort');

  const publicRequest = fakeRoute('https://jobs.example/opening', 'document');
  await handler(publicRequest);
  assert.equal(publicRequest.action, 'continue');

  const webSocket = {
    closed: false,
    async close() {
      this.closed = true;
    },
  };
  await webSocketHandler(webSocket);
  assert.equal(webSocket.closed, true);
});

function response(status, body = '', headers = {}) {
  return {
    status,
    headers: new Headers(headers),
    body: Buffer.from(body),
  };
}

function fakeRoute(url, resourceType) {
  return {
    action: '',
    request() {
      return {
        url: () => url,
        resourceType: () => resourceType,
      };
    },
    async abort() {
      this.action = 'abort';
    },
    async continue() {
      this.action = 'continue';
    },
  };
}
