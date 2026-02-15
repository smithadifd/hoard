'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { StaleDataBanner } from './StaleDataBanner';

const AUTH_PATHS = ['/login', '/setup'];

interface LayoutShellProps {
  children: React.ReactNode;
  user?: { name: string; email: string } | null;
}

export function LayoutShell({ children, user }: LayoutShellProps) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.includes(pathname);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {user && <Header userName={user.name} userEmail={user.email} />}
        <StaleDataBanner />
        <main className="flex-1 overflow-y-auto p-4 pb-20 lg:p-6 lg:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
