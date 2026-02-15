'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, LogOut, Activity, Shield, Cpu } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';

interface UserMenuProps {
  userName: string;
  userEmail: string;
}

function MenuLink({ href, icon: Icon, label, onClick }: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </Link>
  );
}

export function UserMenu({ userName, userEmail }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => { window.location.href = '/login'; },
      },
    });
  };

  const close = () => setOpen(false);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full p-1.5 hover:bg-accent transition-colors"
        aria-label="User menu"
      >
        <div className="h-8 w-8 rounded-full bg-steam-blue/20 flex items-center justify-center">
          <span className="text-sm font-medium text-steam-blue">
            {userName.charAt(0).toUpperCase()}
          </span>
        </div>
        <span className="hidden lg:block text-sm font-medium truncate max-w-[120px]">
          {userName}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border bg-card shadow-lg z-50 py-1">
          <div className="px-3 py-2 border-b">
            <p className="font-medium text-sm">{userName}</p>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>

          <nav className="py-1">
            <MenuLink href="/settings" icon={Settings} label="API Keys & Config" onClick={close} />
            <MenuLink href="/settings/scoring" icon={Activity} label="Scoring Config" onClick={close} />
            <MenuLink href="/settings/alerts" icon={Shield} label="Alerts" onClick={close} />
            <MenuLink href="/settings/system" icon={Cpu} label="System & Sync" onClick={close} />
          </nav>

          <div className="border-t py-1">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-3 py-2 text-sm w-full hover:bg-accent text-destructive transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
