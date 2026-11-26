import type { Metadata } from 'next';
import Bonus from '@/components/Bonus';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Bonus' };

export default function Page() {
  return <Bonus />;
}
