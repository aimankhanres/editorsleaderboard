import type { Metadata } from 'next';
import Capacity from '@/components/Capacity';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Editing Capacity' };

export default function Page() {
  return <Capacity />;
}
