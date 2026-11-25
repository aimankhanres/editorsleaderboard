import type { Metadata } from 'next';
import Teams from '@/components/Teams';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teams' };

export default function Page() {
  return <Teams />;
}
