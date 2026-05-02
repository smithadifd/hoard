'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { SearchDialog } from './SearchDialog';

/**
 * SearchTrigger — icon button + ⌘K keyboard shortcut that opens the global search dialog.
 * Desktop shows icon + kbd hint; mobile shows icon only.
 */
export function SearchTrigger() {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Match k/K (caps lock, shift) and use e.code as a layout-independent fallback
    const isK = e.key.toLowerCase() === 'k' || e.code === 'KeyK';
    if ((e.metaKey || e.ctrlKey) && isK) {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {/* Mobile: icon-only button to keep the header tight */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Search games"
        className="md:hidden flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors"
      >
        <Search className="h-5 w-5" />
      </button>

      {/* Desktop: input-style button — wider, more discoverable */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Search games (⌘K)"
        className="hidden md:flex items-center gap-2 w-56 lg:w-64 px-3 py-1.5 rounded-md border border-white/[0.08] bg-surface-low/60 hover:bg-surface-high hover:border-white/[0.14] text-sm text-muted-foreground transition-colors"
      >
        <Search className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 text-left">Search games...</span>
        <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-white/[0.12] bg-surface-high text-[10px] font-label leading-none">
          ⌘K
        </kbd>
      </button>

      <SearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
