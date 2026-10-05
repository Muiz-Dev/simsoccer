import type { NextRequest } from 'next/server';

const accountsApiUrl = (process.env.ACCOUNTS_API_URL
  ?? process.env.NEXT_PUBLIC_ACCOUNTS_API_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? '').replace(/\/$/, '');
function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
const trustedOrigins = new Set([
  process.env.SITE_URL ?? 'https://simsoccer.vercel.app',
  'http://localhost:3000',
].map(normalizeOrigin).filter((origin): origin is string => origin !== null));
const allowedPaths = new Set([
  'signup',
  'signin',
  'passwordless',
  'verify',
  'password-reset/request',
  'password-reset/complete',
  'password/change',
  'refresh',
  'logout',
  'logout-all',
  'sessions',
  'sessions/revoke',
  '.well-known/jwks.json',
]);

async function proxyAuthRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!accountsApiUrl) {
    return Response.json(
      { error: 'AUTH_UNAVAILABLE', message: 'Account services are not configured.' },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const routePath = path.join('/');
  if (!allowedPaths.has(routePath)) {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (request.method !== 'GET') {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 32 * 1024) {
      return Response.json({ error: 'REQUEST_TOO_LARGE' }, { status: 413 });
    }
    const origin = request.headers.get('origin');
    if (
      !origin
      || (origin !== request.nextUrl.origin && !trustedOrigins.has(normalizeOrigin(origin) ?? ''))
    ) {
      return Response.json({ error: 'UNTRUSTED_ORIGIN' }, { status: 403 });
    }
  }
  const target = new URL(`/api/auth/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, accountsApiUrl);
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  const forwardedCookies = ['ss_refresh', 'ss_device']
    .map((name) => {
      const cookie = request.cookies.get(name);
      return cookie ? `${name}=${encodeURIComponent(cookie.value)}` : null;
    })
    .filter((cookie): cookie is string => cookie !== null);
  if (forwardedCookies.length) headers.set('cookie', forwardedCookies.join('; '));

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    cache: 'no-store',
    redirect: 'manual',
  });
  const responseHeaders = new Headers();
  const responseType = upstream.headers.get('content-type');
  const cacheControl = upstream.headers.get('cache-control');
  if (responseType) responseHeaders.set('content-type', responseType);
  if (cacheControl) responseHeaders.set('cache-control', cacheControl);
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxyAuthRequest;
export const POST = proxyAuthRequest;
