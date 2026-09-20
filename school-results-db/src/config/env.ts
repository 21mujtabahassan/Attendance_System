import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ADMIN_DATABASE_URL: z.string().min(1, 'ADMIN_DATABASE_URL is required'),
  SMS_APP_PASSWORD: z.string().default('sms_app_password'),
  JWT_SECRET: z.string().default('dev_jwt_secret_key_change_in_production_min_32_chars_long'),
  POSTGRES_PORT: z.coerce.number().default(5432)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
