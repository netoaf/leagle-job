# Network and SSRF Safety

Leagle Job accepts career-page URLs from configuration, job records, redirects
and discovered links. Those inputs are untrusted even when the original page
looks legitimate.

## Threat model

The outbound network boundary protects against:

- non-HTTP protocols such as `file:`, `data:`, FTP and local file access;
- embedded URL credentials and caller-controlled `Host` headers;
- loopback, private, link-local, carrier-grade NAT, multicast, reserved and
  documentation IP ranges;
- cloud metadata endpoints;
- hostnames that return a mix of public and private A/AAAA results;
- alternate numeric IP notation normalized by the standard URL parser;
- redirects to a private/internal destination;
- HTTPS redirects that downgrade to unencrypted HTTP;
- DNS rebinding between validation and the Node transport connection;
- requests to arbitrary ports;
- unbounded redirect chains, request bodies, response bodies and timeouts;
- credential forwarding when a redirect changes origin.

## Architecture

`lib/network/safe-fetch.mjs` is the only approved direct HTTP client for
Leagle Job scripts.

For every request it:

1. parses and normalizes the URL with the Node `URL` implementation;
2. allows only HTTP(S), with per-call HTTPS and hostname allowlists;
3. resolves all addresses using the operating-system resolver;
4. rejects the entire result when any A/AAAA address is non-public;
5. selects a validated public address;
6. gives that address to the Node HTTP(S) connection through a custom
   `lookup` callback, so the connection cannot silently resolve a different
   address;
7. handles redirects itself and repeats the full validation for every hop;
8. buffers only a bounded response and exposes a small Fetch-compatible
   response interface.

The browser guard in `lib/network/playwright-guard.mjs` validates the initial
navigation and every intercepted HTTP(S) request, blocks WebSockets and is used
with service workers disabled. Chromium controls its own socket resolution, so
Playwright does not provide the same connection-level IP pinning guarantee as
the Node transport. Browser extraction remains an explicit fallback with
stricter action controls and human review.

## Default budgets

- protocols: HTTP and HTTPS;
- methods: GET, HEAD and POST;
- ports: 80 and 443;
- timeout: 20 seconds;
- redirects: 3;
- request body: 1 MiB;
- response body: 8 MiB;
- response headers: 32 KiB.

Consumers may lower these limits. Raising them requires a documented reason.
New imported adapters must require HTTPS unless the provider demonstrably
offers no HTTPS endpoint.

## Consumers in scope

- job scanning and job-description extraction;
- portal/source health audit;
- open job boards, structured search and Net-Empregos;
- Browser Use Cloud API calls;
- update availability checks;
- local Playwright extraction and liveness checks.

Git's own upstream fetch in the update command is not an HTTP-client call made
by application code and remains governed separately by Git remote/provenance
controls.

## Verification

Run:

```text
npm run test:safe-fetch
npm run jobfinder:health
npm run verify
```

The offline security tests cover IP ranges, schemes, credentials, ports,
allowlists, mixed DNS answers, IP pinning, redirect revalidation, secret-header
stripping and byte/redirect budgets. They use synthetic resolvers and
transports and perform no live network request.

## Sources

- OWASP SSRF Prevention Cheat Sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>
- OWASP SSRF Prevention in Node.js:
  <https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html>
- Node.js DNS API:
  <https://nodejs.org/api/dns.html>
- Node.js HTTP API and custom `lookup` option:
  <https://nodejs.org/api/http.html>

This is an independent Leagle Job-native implementation. No JobNavigator source
code was copied.
