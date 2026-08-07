import postgres from 'postgres';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: '.env.local' });

const sql = postgres(process.env.SUPABASE_DB_URL);
try {
  await sql`CREATE TABLE IF NOT EXISTS admin_otp_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  console.log('✓ Migration 196 applied — admin_otp_tokens table created.');
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await sql.end();
}
