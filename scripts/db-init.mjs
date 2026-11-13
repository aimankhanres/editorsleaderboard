// Usage: DATABASE_URL=... npm run db:init
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first'); process.exit(1); }
const sql = neon(url);
const statements = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
  .replace(/--.*$/gm, '')
  .split(';').map(s => s.trim()).filter(Boolean);
for (const s of statements) await sql(s);
console.log(`Applied ${statements.length} statements.`);
