// OceanFishy CORS proxy — Cloudflare Worker
//
// Purpose: coastwatch.noaa.gov / coastwatch.pfeg.noaa.gov's ERDDAP griddap
// JSON endpoints don't send CORS headers, so the browser can't fetch them
// directly from a page hosted elsewhere (GitHub Pages). This Worker sits in
// between: the app fetches THIS Worker with the real NOAA URL as a query
// param, the Worker fetches NOAA server-side (no CORS restriction there),
// and adds the CORS header back on the way out.
//
// This replaces dependency on shared, free, unauthenticated third-party
// proxies (corsproxy.io, r.jina.ai, codetabs, cors.eu.org) that this app
// used previously — those rate-limit by IP with no way to request more
// headroom, and are shared across everyone using them, not just this app.
// A dedicated Worker is 100% under your own control, on Cloudflare's free
// tier (100,000 requests/day, far more than this app needs).
//
// Deploy: Cloudflare dashboard → Workers & Pages → Create → paste this file
// as the Worker script → Deploy. Note the resulting URL
// (https://<worker-name>.<your-subdomain>.workers.dev) and give it to
// Claude/paste it into index.html's OWN_PROXY_URL constant.
//
// Allowlisted to NOAA ERDDAP hosts only — deliberately not a general-purpose
// open proxy, so it can't be abused to proxy arbitrary traffic through your
// Cloudflare account.

const ALLOWED_HOSTS = ['coastwatch.noaa.gov', 'coastwatch.pfeg.noaa.gov'];

export default {
  async fetch(request) {
    // CORS preflight — the browser sends this before the real GET when a
    // custom setup triggers one; harmless to always answer it.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
    }

    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');
    if (!target) {
      return new Response('Missing "url" query parameter', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response('Invalid target URL', { status: 400 });
    }
    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response('Host not allowed: ' + targetUrl.hostname, { status: 403 });
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'OceanFishy-CORS-Proxy/1.0' },
      });
    } catch (e) {
      return new Response('Upstream fetch failed: ' + e.message, { status: 502 });
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        // NOAA data updates at most daily — short edge cache cuts repeat
        // load on both NOAA and your Worker's request quota for the exact
        // same query landing twice in quick succession (e.g. two users
        // panning to the same spot), without ever serving stale data for
        // more than a few minutes.
        'Cache-Control': 'public, max-age=120',
      },
    });
  },
};
