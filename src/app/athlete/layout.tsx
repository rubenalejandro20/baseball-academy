import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Exercise Plan – Baseball Academy',
  description: 'View your weekly exercises assigned by your physician.',
};

export default function AthleteLayout({ children }: { children: React.ReactNode }) {
  return <div className="athlete-page">{children}</div>;
}
