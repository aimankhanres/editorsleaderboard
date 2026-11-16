import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | null = null;

/** Neon HTTP client. Call as db()(text, params) or db()`...` */
export function db(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Next.js caches fetch() by default, and Neon queries go over fetch: never cache them.
  client ??= neon(url, { fetchOptions: { cache: 'no-store' } });
  return client;
}

/** Run a parameterised query and return rows */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db()(text, params)) as T[];
}
