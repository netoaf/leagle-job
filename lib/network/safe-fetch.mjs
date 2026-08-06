import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_ALLOWED_PORTS = new Set([80, 443]);
const DEFAULT_ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST']);
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-browser-use-api-key',
]);
const LOCAL_HOST_SUFFIXES = [
  'localhost',
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
];

const BLOCKED_IPV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4');
}

const BLOCKED_IPV6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6');
}

export class SafeFetchError extends Error {
  constructor(message, code = 'SAFE_FETCH_ERROR', options = {}) {
    super(message, options);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

export class UnsafeUrlError extends SafeFetchError {
  constructor(message, code = 'UNSAFE_URL', options = {}) {
    super(message, code, options);
    this.name = 'UnsafeUrlError';
  }
}

export function isPublicIp(address) {
  const normalized = normalizeIpLiteral(address);
  const family = isIP(normalized);
  if (family === 4) return !BLOCKED_IPV4.check(normalized, 'ipv4');
  if (family === 6) return !BLOCKED_IPV6.check(normalized, 'ipv6');
  return false;
}

export async function assertPublicHttpUrl(rawUrl, options = {}) {
  const parsed = parseAndNormalizeUrl(rawUrl);
  const requireHttps = options.requireHttps === true;
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('HTTPS is required for this request.', 'HTTPS_REQUIRED');
  }

  const allowedPorts = normalizeAllowedPorts(options.allowedPorts);
  const effectivePort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (!allowedPorts.has(effectivePort)) {
    throw new UnsafeUrlError(`Network port ${effectivePort} is not allowed.`, 'PORT_NOT_ALLOWED');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isLocalHostname(hostname)) {
    throw new UnsafeUrlError('Local and internal hostnames are not allowed.', 'LOCAL_HOST_BLOCKED');
  }
  if (!hostAllowed(hostname, options.allowedHosts)) {
    throw new UnsafeUrlError('Hostname is outside the approved allowlist.', 'HOST_NOT_ALLOWED');
  }

  let addresses;
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    const resolver = options.resolver || resolveWithSystemLookup;
    try {
      addresses = await resolver(hostname);
    } catch (error) {
      throw new UnsafeUrlError('Hostname resolution failed.', 'DNS_RESOLUTION_FAILED', { cause: error });
    }
  }

  const normalizedAddresses = normalizeResolvedAddresses(addresses);
  if (normalizedAddresses.length === 0) {
    throw new UnsafeUrlError('Hostname did not resolve to an IP address.', 'DNS_NO_ADDRESSES');
  }

  const unsafe = normalizedAddresses.find((entry) => !isPublicIp(entry.address));
  if (unsafe) {
    throw new UnsafeUrlError('Hostname resolves to a non-public IP address.', 'NON_PUBLIC_IP');
  }

  const selected = normalizedAddresses.find((entry) => entry.family === 4)
    || normalizedAddresses[0];

  return {
    url: parsed,
    hostname,
    addresses: normalizedAddresses,
    address: selected.address,
    family: selected.family,
    port: effectivePort,
  };
}

export function createSafeFetch(dependencies = {}) {
  const resolver = dependencies.resolver || resolveWithSystemLookup;
  const requester = dependencies.requester || requestOnce;

  return async function safeFetchWithDependencies(rawUrl, options = {}) {
    const policy = normalizePolicy(options);
    const initialMethod = normalizeMethod(options.method);
    const initialHeaders = normalizeHeaders(options.headers);
    const initialBody = normalizeRequestBody(options.body, policy.maxRequestBytes);
    if (initialBody && ['GET', 'HEAD'].includes(initialMethod)) {
      throw new SafeFetchError(`${initialMethod} requests may not contain a body.`, 'BODY_NOT_ALLOWED');
    }
    const redirectMode = normalizeRedirectMode(options.redirect);

    let currentUrl = rawUrl;
    let currentMethod = initialMethod;
    let currentHeaders = initialHeaders;
    let currentBody = initialBody;
    let redirectCount = 0;
    let redirected = false;

    while (true) {
      const validated = await assertPublicHttpUrl(currentUrl, {
        resolver,
        requireHttps: policy.requireHttps,
        allowedPorts: policy.allowedPorts,
        allowedHosts: policy.allowedHosts,
      });

      const rawResponse = await requester(validated.url, {
        address: validated.address,
        family: validated.family,
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        timeoutMs: policy.timeoutMs,
        maxResponseBytes: policy.maxResponseBytes,
        signal: options.signal,
      });
      const response = normalizeRawResponse(rawResponse, validated.url, redirected);

      if (response._body.length > policy.maxResponseBytes) {
        throw new SafeFetchError('Response exceeded the configured byte limit.', 'RESPONSE_TOO_LARGE');
      }

      if (!isRedirectStatus(response.status) || !response.headers.get('location')) {
        return response;
      }
      if (redirectMode === 'manual') return response;
      if (redirectMode === 'error') {
        throw new SafeFetchError('Redirects are disabled for this request.', 'REDIRECT_NOT_ALLOWED');
      }
      if (redirectCount >= policy.maxRedirects) {
        throw new SafeFetchError('Too many redirects.', 'TOO_MANY_REDIRECTS');
      }

      const nextUrl = resolveRedirectUrl(response.headers.get('location'), validated.url);
      if (
        validated.url.protocol === 'https:'
        && nextUrl.protocol === 'http:'
        && policy.allowHttpsDowngrade !== true
      ) {
        throw new SafeFetchError('HTTPS redirects may not downgrade to HTTP.', 'HTTPS_DOWNGRADE_BLOCKED');
      }
      const crossOrigin = nextUrl.origin !== validated.url.origin;
      if (crossOrigin) currentHeaders = stripSensitiveHeaders(currentHeaders);

      if (
        response.status === 303
        || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
      ) {
        currentMethod = 'GET';
        currentBody = null;
        currentHeaders.delete('content-length');
        currentHeaders.delete('content-type');
      }

      currentUrl = nextUrl;
      redirectCount += 1;
      redirected = true;
    }
  };
}

export const safeFetch = createSafeFetch();

class BufferedSafeResponse {
  constructor({ status, statusText, headers, body, url, redirected }) {
    this.status = status;
    this.statusText = statusText || http.STATUS_CODES[status] || '';
    this.headers = headers instanceof Headers ? headers : new Headers(headers || {});
    this.url = String(url);
    this.redirected = redirected === true;
    this.ok = status >= 200 && status < 300;
    this.bodyUsed = false;
    this._body = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body || '');
  }

  async text() {
    return this.#consume().toString('utf8');
  }

  async json() {
    return JSON.parse(this.#consume().toString('utf8'));
  }

  async arrayBuffer() {
    const bytes = Uint8Array.from(this.#consume());
    return bytes.buffer;
  }

  clone() {
    if (this.bodyUsed) throw new TypeError('Cannot clone a response after its body was consumed.');
    return new BufferedSafeResponse({
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      body: this._body,
      url: this.url,
      redirected: this.redirected,
    });
  }

  #consume() {
    if (this.bodyUsed) throw new TypeError('Response body has already been consumed.');
    this.bodyUsed = true;
    return Buffer.from(this._body);
  }
}

async function resolveWithSystemLookup(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function parseAndNormalizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' && !(rawUrl instanceof URL)) {
    throw new UnsafeUrlError('URL must be a string or URL object.', 'INVALID_URL');
  }
  const input = String(rawUrl).trim();
  if (!input || input.length > 4096) {
    throw new UnsafeUrlError('URL is empty or too long.', 'INVALID_URL');
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch (error) {
    throw new UnsafeUrlError('URL is invalid.', 'INVALID_URL', { cause: error });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UnsafeUrlError('Only HTTP and HTTPS URLs are allowed.', 'PROTOCOL_NOT_ALLOWED');
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('Credentials embedded in URLs are not allowed.', 'URL_CREDENTIALS_BLOCKED');
  }
  if (!parsed.hostname) {
    throw new UnsafeUrlError('URL hostname is required.', 'HOST_REQUIRED');
  }
  return parsed;
}

function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function normalizeIpLiteral(value) {
  return normalizeHostname(value).split('%')[0];
}

function isLocalHostname(hostname) {
  return LOCAL_HOST_SUFFIXES.some((suffix) => (
    suffix.startsWith('.') ? hostname.endsWith(suffix) : hostname === suffix
  ));
}

function hostAllowed(hostname, rules) {
  if (!rules) return true;
  const values = Array.isArray(rules) ? rules : [rules];
  if (values.length === 0) return false;
  return values.some((value) => {
    const rule = normalizeHostname(value);
    if (!rule) return false;
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1);
      return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === rule;
  });
}

function normalizeResolvedAddresses(entries) {
  const values = Array.isArray(entries) ? entries : [entries];
  const seen = new Set();
  const result = [];

  for (const entry of values) {
    const address = normalizeIpLiteral(typeof entry === 'string' ? entry : entry?.address);
    const family = Number(typeof entry === 'object' ? entry?.family : isIP(address));
    if (!address || ![4, 6].includes(family) || isIP(address) !== family) continue;
    const key = `${family}:${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ address, family });
  }

  return result;
}

function normalizeAllowedPorts(value) {
  if (value === undefined || value === null) return DEFAULT_ALLOWED_PORTS;
  const ports = Array.isArray(value) || value instanceof Set ? [...value] : [value];
  const normalized = new Set(ports.map(Number).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535));
  if (normalized.size === 0) {
    throw new UnsafeUrlError('At least one valid allowed port is required.', 'INVALID_PORT_POLICY');
  }
  return normalized;
}

function normalizePolicy(options) {
  return {
    timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 120_000, 'timeoutMs'),
    maxResponseBytes: boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1,
      100 * 1024 * 1024,
      'maxResponseBytes',
    ),
    maxRequestBytes: boundedInteger(
      options.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      0,
      10 * 1024 * 1024,
      'maxRequestBytes',
    ),
    maxRedirects: boundedInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 10, 'maxRedirects'),
    requireHttps: options.requireHttps === true,
    allowHttpsDowngrade: options.allowHttpsDowngrade === true,
    allowedPorts: options.allowedPorts,
    allowedHosts: options.allowedHosts,
  };
}

function boundedInteger(value, fallback, min, max, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new SafeFetchError(`${label} must be an integer between ${min} and ${max}.`, 'INVALID_POLICY');
  }
  return number;
}

function normalizeMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
  if (!DEFAULT_ALLOWED_METHODS.has(method)) {
    throw new SafeFetchError('Only GET, HEAD and POST methods are allowed.', 'METHOD_NOT_ALLOWED');
  }
  return method;
}

function normalizeHeaders(value) {
  const headers = new Headers(value || {});
  if (headers.has('host')) {
    throw new SafeFetchError('Caller-controlled Host headers are not allowed.', 'HOST_HEADER_BLOCKED');
  }
  headers.delete('connection');
  headers.delete('proxy-connection');
  headers.set('accept-encoding', 'identity');
  return headers;
}

function normalizeRequestBody(value, maxBytes) {
  if (value === undefined || value === null) return null;
  let body;
  if (typeof value === 'string') body = Buffer.from(value);
  else if (Buffer.isBuffer(value)) body = Buffer.from(value);
  else if (value instanceof ArrayBuffer) body = Buffer.from(value);
  else if (ArrayBuffer.isView(value)) body = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  else if (value instanceof URLSearchParams) body = Buffer.from(value.toString());
  else throw new SafeFetchError('Unsupported request body type.', 'UNSUPPORTED_BODY');

  if (body.length > maxBytes) {
    throw new SafeFetchError('Request body exceeded the configured byte limit.', 'REQUEST_TOO_LARGE');
  }
  return body;
}

function normalizeRedirectMode(value) {
  const mode = String(value || 'follow').toLowerCase();
  if (!['follow', 'manual', 'error'].includes(mode)) {
    throw new SafeFetchError('redirect must be follow, manual or error.', 'INVALID_REDIRECT_POLICY');
  }
  return mode;
}

function normalizeRawResponse(value, url, redirected) {
  if (!value || typeof value !== 'object') {
    throw new SafeFetchError('Network transport returned an invalid response.', 'INVALID_RESPONSE');
  }
  const status = Number(value.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new SafeFetchError('Network transport returned an invalid HTTP status.', 'INVALID_RESPONSE');
  }
  return new BufferedSafeResponse({
    status,
    statusText: value.statusText,
    headers: value.headers,
    body: value.body,
    url,
    redirected,
  });
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function resolveRedirectUrl(location, baseUrl) {
  let next;
  try {
    next = new URL(location, baseUrl);
  } catch (error) {
    throw new SafeFetchError('Redirect location is invalid.', 'INVALID_REDIRECT', { cause: error });
  }
  return next;
}

function stripSensitiveHeaders(headers) {
  const next = new Headers(headers);
  for (const name of SENSITIVE_HEADERS) next.delete(name);
  return next;
}

function requestOnce(url, options) {
  const transport = url.protocol === 'https:' ? https : http;
  const hostname = normalizeHostname(url.hostname);
  const requestHeaders = Object.fromEntries(options.headers.entries());
  if (options.body && !options.headers.has('content-length')) {
    requestHeaders['content-length'] = String(options.body.length);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const fail = (error) => finish(reject, error);
    const onAbort = () => {
      const error = new SafeFetchError('Request was aborted.', 'REQUEST_ABORTED');
      if (request) request.destroy(error);
      else fail(error);
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    const requestOptions = {
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method,
      headers: requestHeaders,
      maxHeaderSize: 32 * 1024,
      autoSelectFamily: false,
      lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions?.all === true) {
          callback(null, [{ address: options.address, family: options.family }]);
          return;
        }
        callback(null, options.address, options.family);
      },
    };
    if (url.protocol === 'https:' && isIP(hostname) === 0) requestOptions.servername = hostname;

    request = transport.request(requestOptions, (response) => {
      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > options.maxResponseBytes) {
        response.destroy();
        fail(new SafeFetchError('Response exceeded the configured byte limit.', 'RESPONSE_TOO_LARGE'));
        return;
      }

      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > options.maxResponseBytes) {
          response.destroy();
          fail(new SafeFetchError('Response exceeded the configured byte limit.', 'RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(resolve, {
        status: response.statusCode || 0,
        statusText: response.statusMessage || '',
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.on('error', fail);
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new SafeFetchError('Request timed out.', 'REQUEST_TIMEOUT'));
    });
    request.on('error', fail);
    if (options.body) request.write(options.body);
    request.end();
  });
}
