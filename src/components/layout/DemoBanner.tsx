import { isDemoMode, DEMO_REPO_URL } from '@/lib/demo';
import { ExternalLink } from 'lucide-react';

export function DemoBanner() {
  if (!isDemoMode()) return null;

  return (
    <div className="bg-primary text-primary-foreground text-sm text-center py-1.5 px-4 flex items-center justify-center gap-2 shrink-0 font-label font-medium">
      <span>Demo Mode — data resets weekly.</span>
      <a
        href={DEMO_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-primary-foreground/80"
      >
        View source on GitHub
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
