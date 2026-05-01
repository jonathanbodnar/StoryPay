/**
 * Bearer-token authentication helper for the public /api/v1/* routes.
 *
 * Usage in a route handler:
 *
 *   const auth = await authenticateApiV1(request);
 *   if (!auth.ok) return auth.response;
 *   const { venueId, apiKey } = auth;
 *
 * Accepts both `Authorization: Bearer sv_live_...` and `X-StoryVenue-Api-Key` headers.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { validateApiKey, type ApiKeyRow } from './api-keys';

export interface AuthFailure {
  ok: false;
  response: NextResponse;
}
export interface AuthSuccess {
  ok: true;
  venueId: string;
  apiKey: ApiKeyRow;
}
export type AuthResult = AuthSuccess | AuthFailure;

function unauthorized(reason: string): AuthFailure {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'unauthorized',
        message: reason,
        docs: 'https://storyvenue.com/help/integrations',
      },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="StoryVenue", error="invalid_token"',
        },
      },
    ),
  };
}

/** Pulls the bearer token from the request, in priority order. */
function extractToken(req: NextRequest | Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (auth) {
    const m = auth.match(/^bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const xKey = req.headers.get('x-storyvenue-api-key');
  if (xKey) return xKey.trim();
  return null;
}

export async function authenticateApiV1(req: NextRequest | Request): Promise<AuthResult> {
  const token = extractToken(req);
  if (!token) return unauthorized('Missing API key. Send `Authorization: Bearer sv_live_...`.');

  const row = await validateApiKey(token);
  if (!row) return unauthorized('Invalid or revoked API key.');

  return { ok: true, venueId: row.venue_id, apiKey: row };
}

/**
 * Convenience helper for routes that want to enforce a specific scope
 * (defaults to no scope check — most endpoints accept read+write).
 */
export async function authenticateApiV1WithScope(
  req: NextRequest | Request,
  required: 'read' | 'write',
): Promise<AuthResult> {
  const auth = await authenticateApiV1(req);
  if (!auth.ok) return auth;
  if (!auth.apiKey.scopes.includes(required)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'insufficient_scope', message: `This API key is missing the "${required}" scope.` },
        { status: 403 },
      ),
    };
  }
  return auth;
}

/** Standard CORS headers for the public API. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-StoryVenue-Api-Key, Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

/** Preflight responder usable as `OPTIONS` from any /api/v1/* route. */
export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
