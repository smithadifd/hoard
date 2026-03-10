'use client';

import { useState } from 'react';
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
  CalendarClock,
  MoreHorizontal,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: 'Browse',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    label: 'My Games',
    items: [
      { name: 'Library', href: '/library', icon: Library },
      { name: 'Backlog', href: '/backlog', icon: Gamepad2 },
    ],
  },
  {
    label: 'Tracking',
    items: [
      { name: 'Wishlist', href: '/wishlist', icon: Heart },
      { name: 'Releases', href: '/releases', icon: CalendarClock },
      { name: 'Watchlist', href: '/watchlist', icon: Bell },
    ],
  },
  {
    label: 'Tools',
    items: [
      { name: 'Triage', href: '/triage', icon: ListChecks },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

/** Primary mobile tabs (shown in bottom bar) */
const mobileTabItems: NavItem[] = [
  { name: 'Home', href: '/', icon: LayoutDashboard },
  { name: 'Library', href: '/library', icon: Library },
  { name: 'Wishlist', href: '/wishlist', icon: Heart },
  { name: 'Backlog', href: '/backlog', icon: Gamepad2 },
];

/** Secondary items (shown in More menu) */
const mobileMoreItems: NavItem[] = [
  { name: 'Releases', href: '/releases', icon: CalendarClock },
  { name: 'Watchlist', href: '/watchlist', icon: Bell },
  { name: 'Triage', href: '/triage', icon: ListChecks },
  { name: 'Settings', href: '/settings', icon: Settings },
];

function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function isMoreActive(pathname: string): boolean {
  return mobileMoreItems.some((item) => isNavActive(pathname, item.href));
}

export function Sidebar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

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
        <nav className="flex-1 p-4 space-y-4">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
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
              </div>
            </div>
          ))}
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
          {mobileTabItems.map((item) => {
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

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full text-[11px] font-medium transition-colors ${
              isMoreActive(pathname)
                ? 'text-steam-blue'
                : 'text-muted-foreground'
            }`}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      {/* Mobile More menu (bottom sheet) */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div
            className="lg:hidden fixed inset-0 z-[60] bg-black/50"
            onClick={() => setMoreOpen(false)}
          />

          {/* Sheet */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[70] bg-card border-t border-border rounded-t-2xl safe-bottom">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-foreground">More</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="px-2 pb-4 space-y-0.5">
              {mobileMoreItems.map((item) => {
                const isActive = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
