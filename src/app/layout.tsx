import type { Metadata, Viewport } from 'next';
import { Manrope, Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { LayoutShell } from '@/components/layout/LayoutShell';
import { PwaProvider } from '@/components/layout/PwaProvider';
import { DemoBanner } from '@/components/layout/DemoBanner';
import { getSession } from '@/lib/auth-helpers';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
});

const grotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk',
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Hoard - Game Deal Tracker & Backlog Manager',
  description: 'Track game deals, manage your backlog, and find your next game to play.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Hoard',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#131313',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: { name: string; email: string } | null = null;
  try {
    const session = await getSession();
    if (session?.user) {
      user = { name: session.user.name, email: session.user.email };
    }
  } catch {
    // No session available (e.g., during build or on auth pages)
  }

  return (
    <html lang="en" className="dark">
      <body className={`${manrope.variable} ${jakarta.variable} ${grotesk.variable} font-body`}>
        <DemoBanner />
        <PwaProvider>
          <LayoutShell user={user}>
            {children}
          </LayoutShell>
        </PwaProvider>
      </body>
    </html>
  );
}
