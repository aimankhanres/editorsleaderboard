import type { Metadata } from 'next';
import Briefs from '@/components/Briefs';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Briefs & pipeline' };

export default function Page() {
  return <Briefs />;
}
