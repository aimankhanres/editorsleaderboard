import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optional shared-password gate (HTTP Basic auth, any username). Off unless APP_PASSWORD is set.
 * Replace with Google sign-in (e.g. Auth.js restricted to the company domain) if that's the decision.
 * /api/sync and /api/clickup-webhook have their own secrets and are not gated here.
 */
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = atob(header.slice(6));
    if (decoded.slice(decoded.indexOf(':') + 1) === password) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Editor Leaderboard"' },
  });
}

export const config = { matcher: ['/((?!api/sync|api/clickup-webhook|_next/static|_next/image|favicon.ico).*)'] };
