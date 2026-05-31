'use client';

import { useEffect } from 'react';

/**
 * Root segment error boundary. Catches render/runtime errors in any page under
 * `src/app/` (dashboard, library, games/[id], settings, …) and offers in-app
 * recovery instead of falling through to Next's default error screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        An unexpected error occurred while rendering this page.
      </p>
      <button
        onClick={() => reset()}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px]"
      >
        Try again
      </button>
    </div>
  );
}
