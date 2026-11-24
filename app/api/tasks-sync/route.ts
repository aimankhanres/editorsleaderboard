import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { editorTasksPage } from '@/lib/clickup';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  // ?diag=1&reverse=true|false : one page, read-only, to check filter and order
  if (url.searchParams.get('diag')) {
    const p = await editorTasksPage(Number(url.searchParams.get('since') ?? 0), Number(url.searchParams.get('page') ?? 0), { reverse: url.searchParams.get('reverse') !== 'false' });
    return NextResponse.json({
      n: p.tasks.length, lastPage: p.lastPage,
      updated: p.tasks.map(t => t.updated).slice(0, 5).concat(p.tasks.map(t => t.updated).slice(-3)),
      withEditDone: p.tasks.filter(t => t.editDone).length, withEditors: p.tasks.filter(t => t.editors.length).length,
      sample: p.tasks.slice(0, 3),
    });
  }
  return NextResponse.json({ error: 'not implemented yet' }, { status: 400 });
}
