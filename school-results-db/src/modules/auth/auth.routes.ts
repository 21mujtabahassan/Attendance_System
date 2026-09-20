import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signToken, ALLOWED_ROLES, AppRole } from '../../middleware/auth.js';

const devTokenSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ALLOWED_ROLES)
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/api/auth/dev-token', {
    schema: {
      tags: ['Authentication'],
      summary: 'Issue a development JWT for testing and API interaction',
      body: {
        type: 'object',
        required: ['userId', 'role'],
        properties: {
          userId: { type: 'string', format: 'uuid' },
          role: { type: 'string', enum: ALLOWED_ROLES as any }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                role: { type: 'string' }
              }
            }
          }
        },
        400: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (req, reply) => {
    const parsed = devTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid token request body',
        issues: parsed.error.issues
      });
    }

    const { userId, role } = parsed.data;
    const token = signToken({ userId, role });

    return {
      token,
      user: { userId, role }
    };
  });
}
