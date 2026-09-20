import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(error: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  // 1. Zod Validation Error
  if (error instanceof ZodError) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      issues: error.issues
    });
  }

  // 2. Fastify Validation Error
  if ('validation' in error && error.validation) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: error.message,
      validation: error.validation
    });
  }

  // 3. PostgreSQL Database Error
  const pgError = error as any;
  if (pgError && pgError.code) {
    const code = pgError.code;
    const message = pgError.message || 'Database error';

    // 42501: insufficient_privilege
    if (code === '42501' || message.includes('is not allowed')) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message
      });
    }

    // 23001: restrict_violation (guard functions)
    if (code === '23001' || message.includes('LOCKED') || message.includes('PUBLISHED') || message.includes('immutable')) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message
      });
    }

    // 23505: unique_violation
    if (code === '23505') {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: pgError.detail || message
      });
    }

    // 23514: check_violation
    if (code === '23514') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: pgError.detail || message
      });
    }

    // 23503: foreign_key_violation
    if (code === '23503') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: pgError.detail || message
      });
    }

    // P0001: raise_exception from PL/pgSQL
    if (code === 'P0001') {
      if (message.includes('not found')) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message
        });
      }
      if (message.includes('not allowed') || message.includes('Role')) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message
        });
      }
      if (message.includes('LOCKED') || message.includes('PUBLISHED') || message.includes('Illegal transition')) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message
        });
      }
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message
      });
    }

    return reply.status(500).send({
      statusCode: 500,
      error: 'Database Error',
      message
    });
  }

  // 4. Fallback Generic Error
  const statusCode = (error as any).statusCode || 500;
  return reply.status(statusCode).send({
    statusCode,
    error: (error as any).name || 'Internal Server Error',
    message: error.message || 'An unexpected error occurred'
  });
}
