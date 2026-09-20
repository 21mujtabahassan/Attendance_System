import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const ALLOWED_ROLES = [
  'teacher',
  'exam_controller',
  'principal',
  'admin',
  'student',
  'parent',
  'system'
] as const;

export type AppRole = (typeof ALLOWED_ROLES)[number];

export interface AuthUser {
  userId: string;
  role: AppRole;
  exp?: number;
  iat?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf-8');
}

/**
 * Signs a standard HS256 JWT token using built-in node:crypto.
 */
export function signToken(payload: { userId: string; role: AppRole }, expiresInSec = 7 * 24 * 3600): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AuthUser = {
    ...payload,
    iat: now,
    exp: now + expiresInSec
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verifies a HS256 JWT token using built-in node:crypto.
 */
export function verifyToken(token: string): AuthUser {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token structure');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expectedSignature) {
    throw new Error('Invalid token signature');
  }

  const payload: AuthUser = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) {
    throw new Error('Token has expired');
  }

  return payload;
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header'
    });
  }

  const token = authHeader.substring(7).trim();
  try {
    const decoded = verifyToken(token);

    if (!decoded.userId || !decoded.role) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid token payload: missing userId or role'
      });
    }

    if (!ALLOWED_ROLES.includes(decoded.role)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Disallowed or unknown role: ${decoded.role}`
      });
    }

    req.user = {
      userId: decoded.userId,
      role: decoded.role
    };
  } catch (err: any) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: err.message || 'Invalid or expired token'
    });
  }
}

export function requireRole(...roles: AppRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (!req.user) return;

    if (!roles.includes(req.user.role) && req.user.role !== 'admin' && req.user.role !== 'system') {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Role "${req.user.role}" is not permitted to access this resource`
      });
    }
  };
}
