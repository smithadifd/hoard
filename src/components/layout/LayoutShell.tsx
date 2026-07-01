'use client';

import { usePathname } from 'next/navigation';
import { SCROLL_CONTAINER_ID, trackPreviousPathname } from '@/hooks/useScrollRestoration';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { StaleDataBanner } from './StaleDataBanner';
import { DrainPausedBanner } from './DrainPausedBanner';
import { UpdatePrompt } from './UpdatePrompt';

const AUTH_PATHS = ['/login', '/setup', '/onboarding'];

interface LayoutShellProps {
  children: React.ReactNode;
  user?: { name: string; email: string } | null;
}

export function LayoutShell({ children, user }: LayoutShellProps) {
  const pathname = usePathname();
  // Record route transitions so list views can detect a return from a game
  // detail and restore scroll only then (see useScrollRestoration).
  trackPreviousPathname(pathname);
  const isAuthPage = AUTH_PATHS.includes(pathname);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {user && <Header userName={user.name} userEmail={user.email} />}
        <UpdatePrompt />
        <DrainPausedBanner />
        <StaleDataBanner />
        <main id={SCROLL_CONTAINER_ID} className="flex-1 overflow-y-auto p-4 pb-20 lg:p-6 lg:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
