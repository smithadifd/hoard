import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  current: number;
  total: number;
  pageSize: number;
  basePath: string;
  searchParams?: Record<string, string>;
}

export function Pagination({
  current,
  total,
  pageSize,
  basePath,
  searchParams = {},
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const buildHref = (page: number) => {
    const params = new URLSearchParams(searchParams);
    if (page > 1) {
      params.set('page', String(page));
    } else {
      params.delete('page');
    }
    const qs = params.toString();
    return `${basePath}${qs ? '?' + qs : ''}`;
  };

  const linkClasses =
    'inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors';
  const inactiveLinkClasses =
    'text-muted-foreground hover:text-foreground hover:bg-secondary/50';
  const disabledClasses = 'opacity-30 pointer-events-none';

  return (
    <nav className="flex items-center justify-center gap-2">
      <Link
        href={buildHref(current - 1)}
        className={`${linkClasses} ${current <= 1 ? disabledClasses : inactiveLinkClasses}`}
        aria-disabled={current <= 1}
        tabIndex={current <= 1 ? -1 : undefined}
      >
        <ChevronLeft className="h-4 w-4" />
        Prev
      </Link>

      <span className="text-sm text-muted-foreground px-2">
        Page {current} of {totalPages}
      </span>

      <Link
        href={buildHref(current + 1)}
        className={`${linkClasses} ${current >= totalPages ? disabledClasses : inactiveLinkClasses}`}
        aria-disabled={current >= totalPages}
        tabIndex={current >= totalPages ? -1 : undefined}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  );
}
