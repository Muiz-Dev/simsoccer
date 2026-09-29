import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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

/**
 * Express middleware to verify Supabase Auth Bearer JWT signatures strictly.
 */
export function authenticateJwt(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const secretKey = env.SUPABASE_SECRET_KEY || 'test_secret_key';
    const decoded = jwt.verify(token, secretKey) as any;

    if (!decoded || !decoded.sub) {
      return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid JWT token payload' });
    }

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || 'authenticated',
      app_metadata: decoded.app_metadata,
      user_metadata: decoded.user_metadata,
    };

    return next();
  } catch (err: any) {
    return res.status(401).json({ error: 'INVALID_TOKEN', message: err.message || 'JWT signature verification failed' });
  }
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
