import { assertPublicHttpUrl, UnsafeUrlError } from './safe-fetch.mjs';

const PASS_THROUGH_PROTOCOLS = new Set(['about:', 'blob:', 'data:']);

export async function assertSafeNavigationUrl(url, options = {}) {
  return assertPublicHttpUrl(url, options);
}

export async function installPlaywrightNetworkGuard(context, options = {}) {
  if (!context || typeof context.route !== 'function') {
    throw new TypeError('A Playwright browser context is required.');
  }

  const blockedResourceTypes = new Set(options.blockedResourceTypes || []);
  if (options.blockWebSockets !== false && typeof context.routeWebSocket === 'function') {
    await context.routeWebSocket('**/*', async (route) => {
      await route.close({ code: 1008, reason: 'Blocked by Leagle Job network policy' });
    });
  }

  await context.route('**/*', async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    if (blockedResourceTypes.has(resourceType)) {
      await route.abort('blockedbyclient');
      return;
    }

    let parsed;
    try {
      parsed = new URL(request.url());
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    if (PASS_THROUGH_PROTOCOLS.has(parsed.protocol)) {
      if (resourceType === 'document') await route.abort('blockedbyclient');
      else await route.continue();
      return;
    }

    try {
      await assertPublicHttpUrl(parsed, {
        resolver: options.resolver,
        requireHttps: options.requireHttps === true,
        allowedPorts: options.allowedPorts,
        allowedHosts: options.allowedHosts,
      });
      await route.continue();
    } catch (error) {
      if (!(error instanceof UnsafeUrlError) && options.onError) options.onError(error);
      await route.abort('blockedbyclient');
    }
  });
}
