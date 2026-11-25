import type { Metadata } from 'next';
import Strategists from '@/components/Strategists';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Strategists' };

export default function Page() {
  return <Strategists />;
}
