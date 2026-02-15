'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Library,
  Heart,
  Gamepad2,
  Bell,
  ListChecks,
  Settings,
  TrendingDown,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Library', href: '/library', icon: Library },
  { name: 'Wishlist', href: '/wishlist', icon: Heart },
  { name: 'Backlog', href: '/backlog', icon: Gamepad2 },
  { name: 'Triage', href: '/triage', icon: ListChecks },
  { name: 'Watchlist', href: '/watchlist', icon: Bell },
  { name: 'Settings', href: '/settings', icon: Settings },
];

function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  // Settings sub-routes should highlight the Settings nav item
  return pathname === href || pathname.startsWith(href + '/');
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 border-r border-border bg-card flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-border">
          <Link href="/" className="flex items-center gap-2">
            <TrendingDown className="h-6 w-6 text-steam-blue" />
            <span className="text-xl font-bold">Hoard</span>
          </Link>
          <p className="text-xs text-muted-foreground mt-1">
            Game Deal Tracker
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Hoard v0.1.0
          </p>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card safe-bottom">
        <div className="flex items-center justify-around h-16">
          {navigation.map((item) => {
            const isActive = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'text-steam-blue'
                    : 'text-muted-foreground'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
