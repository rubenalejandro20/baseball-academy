import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Baseball Academy – Athlete Management',
  description: 'Physician dashboard and athlete exercise management platform for baseball academies.',
  icons: { icon: '/7ARlogo.png' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen grain">{children}</body>
    </html>
  );
}
