'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
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
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/Tooltip';

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

const STORAGE_KEY = 'hoard-sidebar-collapsed';

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

  const collapsed = useSyncExternalStore(
    (onStoreChange) => {
      const handler = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) onStoreChange();
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
    () => localStorage.getItem(STORAGE_KEY) === 'true',
    () => false,
  );

  const toggleCollapsed = useCallback(() => {
    const current = localStorage.getItem(STORAGE_KEY) === 'true';
    localStorage.setItem(STORAGE_KEY, String(!current));
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  // Keyboard shortcut: [ to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        toggleCollapsed();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleCollapsed]);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    if (!moreOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMore();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [moreOpen, closeMore]);

  return (
    <>
      {/* Desktop sidebar */}
      <TooltipProvider delayDuration={collapsed ? 100 : 700}>
        <aside
          className={`hidden lg:flex bg-surface-low flex-col transition-[width] duration-200 ${
            collapsed ? 'w-16' : 'w-64'
          }`}
        >
          {/* Logo + collapse toggle */}
          <div className={`pb-8 flex items-center ${collapsed ? 'p-3 pb-6 justify-center' : 'p-6 justify-between'}`}>
            <Link href="/" className="flex items-center gap-2.5">
              <TrendingDown className="h-6 w-6 text-primary shrink-0" />
              {!collapsed && (
                <div>
                  <span className="text-xl font-headline font-extrabold text-primary tracking-tight">Hoard</span>
                  <p className="text-[10px] font-label uppercase tracking-[0.2em] text-muted-foreground/50">
                    Deal Tracker
                  </p>
                </div>
              )}
            </Link>
            {!collapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleCollapsed}
                    className="p-1.5 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/[0.03] transition-colors"
                    aria-label="Collapse sidebar"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Collapse <kbd className="ml-1 px-1 py-0.5 rounded bg-white/10 text-[10px] font-mono">[</kbd>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Navigation */}
          <nav className={`flex-1 space-y-5 ${collapsed ? 'px-1.5' : 'px-3'}`}>
            {navSections.map((section) => (
              <div key={section.label}>
                {!collapsed && (
                  <p className="px-3 mb-1.5 text-[10px] font-label font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">
                    {section.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = isNavActive(pathname, item.href);
                    const linkContent = (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={`flex items-center px-3 py-2 text-sm font-medium transition-all ${
                          collapsed ? 'justify-center' : 'gap-3'
                        } ${
                          isActive
                            ? collapsed
                              ? 'text-primary bg-primary/5 rounded-md'
                              : 'text-primary border-l-2 border-primary bg-primary/5 rounded-r-md'
                            : collapsed
                              ? 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03] rounded-md'
                              : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03] rounded-md border-l-2 border-transparent'
                        }`}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && item.name}
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.name}>
                          <TooltipTrigger asChild>
                            {linkContent}
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {item.name}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return linkContent;
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className={`border-t border-white/[0.06] ${collapsed ? 'p-2' : 'p-4'}`}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleCollapsed}
                    className="flex items-center justify-center w-full p-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    aria-label="Expand sidebar"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Expand <kbd className="ml-1 px-1 py-0.5 rounded bg-white/10 text-[10px] font-mono">[</kbd>
                </TooltipContent>
              </Tooltip>
            ) : (
              <p className="text-[10px] font-label text-muted-foreground/40">
                Hoard v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'}
              </p>
            )}
          </div>
        </aside>
      </TooltipProvider>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.06] bg-surface-low/95 backdrop-blur-xl safe-bottom">
        <div className="flex items-center justify-around h-16">
          {mobileTabItems.map((item) => {
            const isActive = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'text-primary'
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
            aria-label="More navigation options"
            aria-expanded={moreOpen}
            aria-controls="mobile-more-menu"
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full text-[11px] font-medium transition-colors ${
              isMoreActive(pathname)
                ? 'text-primary'
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
          <div
            id="mobile-more-menu"
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            className="lg:hidden fixed bottom-0 left-0 right-0 z-[70] bg-surface-low border-t border-white/[0.06] rounded-t-2xl safe-bottom"
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-foreground">More</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="px-2 pb-2 space-y-0.5">
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
            <div className="px-4 pb-4 border-t border-white/[0.06] pt-2">
              <p className="text-[10px] font-label text-muted-foreground/40">
                Hoard v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
