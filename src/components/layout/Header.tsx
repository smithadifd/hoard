'use client';

import { TrendingDown } from 'lucide-react';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  userName: string;
  userEmail: string;
}

export function Header({ userName, userEmail }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-12 items-center justify-between px-4">
        {/* Logo — visible on mobile only (desktop has sidebar) */}
        <div className="flex items-center gap-2 md:hidden">
          <TrendingDown className="h-5 w-5 text-steam-blue" />
          <span className="font-bold">Hoard</span>
        </div>

        {/* Spacer on desktop */}
        <div className="hidden md:block" />

        {/* User menu — always visible */}
        <UserMenu userName={userName} userEmail={userEmail} />
      </div>
    </header>
  );
}
