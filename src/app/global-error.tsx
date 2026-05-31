'use client';

import { useEffect } from 'react';

/**
 * Layout-level error boundary. Catches errors thrown in the root layout itself
 * (which `error.tsx` cannot), so it must render its own <html>/<body> — it
 * replaces the root layout when it fires. Kept deliberately minimal; inline
 * styles are used here only because this renders outside the Tailwind/layout
 * shell.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h2>Application error</h2>
          <p>A critical error occurred. Try reloading the page.</p>
          <button onClick={() => reset()} style={{ padding: '8px 16px', marginTop: 12 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
