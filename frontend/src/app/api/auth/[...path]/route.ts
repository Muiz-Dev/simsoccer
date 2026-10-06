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
  'password/change/request',
  'password/change/confirm',
  'password/change/verify',
  'refresh',
  'logout',
  'logout-all',
  'sessions',
  'sessions/revoke',
  '.well-known/jwks.json',
]);
const accountPaths = new Map([
  ['account/me', { method: 'GET', target: '/api/account/me' }],
  ['account/profile', { method: 'PATCH', target: '/api/account/profile' }],
  ['account/profile/details', { method: 'PATCH', target: '/api/account/profile/details' }],
]);

async function proxyAuthRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!accountsApiUrl) {
    return Response.json(
      { error: 'AUTH_UNAVAILABLE', message: 'Sign-in is temporarily unavailable. Try again.' },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const routePath = path.join('/');
  if (routePath === 'refresh' && request.method !== 'POST') {
    return Response.json({ error: 'METHOD_NOT_ALLOWED', message: 'Sign in to refresh your session.' }, { status: 405 });
  }
  const accountPath = accountPaths.get(routePath);
  if (accountPath && request.method !== accountPath.method) {
    return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  }
  if (!accountPath && !allowedPaths.has(routePath)) {
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
  const targetPath = accountPath?.target ?? `/api/auth/${path.map(encodeURIComponent).join('/')}`;
  const target = new URL(`${targetPath}${request.nextUrl.search}`, accountsApiUrl);
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

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch (error) {
    console.error('Accounts API proxy request failed.', {
      path: routePath,
      errorName: error instanceof Error ? error.name : typeof error,
      ...(
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && (typeof error.code === 'string' || typeof error.code === 'number')
          ? { errorCode: error.code }
          : {}
      ),
    });
    return Response.json(
      { error: 'AUTH_UNAVAILABLE', message: 'Sign-in is temporarily unavailable. Try again.' },
      { status: 503 },
    );
  }
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
export const PATCH = proxyAuthRequest;
