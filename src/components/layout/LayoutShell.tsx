'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';

const AUTH_PATHS = ['/login', '/setup'];

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.includes(pathname);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-4 pb-20 md:p-6 md:pb-6">
        {children}
      </main>
    </div>
  );
}
