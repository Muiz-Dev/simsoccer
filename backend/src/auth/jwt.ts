import { Request, Response, NextFunction } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { env } from '../config/env';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: string;
  app_metadata?: Record<string, any>;
  user_metadata?: Record<string, any>;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

let jwksClientInstance: jwksRsa.JwksClient | null = null;

function getJwksClient(): jwksRsa.JwksClient {
  if (jwksClientInstance) return jwksClientInstance;

  const jwksUri =
    env.SUPABASE_JWKS_URL ||
    (env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json` : '');

  if (!jwksUri) {
    throw new Error('JWT Verification Failed: SUPABASE_JWKS_URL or SUPABASE_URL configuration is missing');
  }

  jwksClientInstance = jwksRsa({
    jwksUri,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  return jwksClientInstance;
}

function getKey(header: JwtHeader, callback: SigningKeyCallback) {
  try {
    const client = getJwksClient();
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      const signingKey = key?.getPublicKey();
      callback(null, signingKey);
    });
  } catch (err: any) {
    callback(err);
  }
}

/**
 * Express middleware to verify Supabase Auth Bearer JWT signatures strictly via JWKS.
 * Validates issuer (iss), audience (aud), expiration (exp), and subject (sub) claims.
 */
export function authenticateJwt(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Bearer token is missing' });
  }

  const expectedIssuer = env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined;

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['RS256', 'ES256', 'HS256'],
      issuer: expectedIssuer,
      audience: 'authenticated',
    },
    (err, decoded: any) => {
      if (err || !decoded || !decoded.sub) {
        return res.status(401).json({
          error: 'INVALID_TOKEN',
          message: err ? err.message : 'Invalid JWT token payload or subject missing',
        });
      }

      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'authenticated',
        app_metadata: decoded.app_metadata,
        user_metadata: decoded.user_metadata,
      };

      return next();
    }
  );
}

/**
 * Middleware to require specific user roles (e.g., 'admin', 'ADMIN', 'SUPER_ADMIN').
 */
export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const userRole = req.user.role || req.user.app_metadata?.role || 'authenticated';
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: `Role '${userRole}' is not permitted to perform this action` });
    }

    return next();
  };
}
