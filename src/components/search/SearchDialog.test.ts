import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SearchDialog } from './SearchDialog';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => createElement('img', { alt: props.alt ?? '' }),
}));

vi.mock('react-remove-scroll', () => ({
  RemoveScroll: ({ children }: { children?: ReactNode }) => children,
}));

// Node has no document, so Radix Portal would drop Content. Inline the portal
// children so the test can observe SearchDialog's rendered DOM Interface.
vi.mock('@radix-ui/react-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-dialog')>();
  return {
    ...actual,
    Portal: ({ children }: { children?: ReactNode }) => children,
  };
});

function classList(html: string, tagPattern: RegExp): string[] {
  const tag = html.match(tagPattern)?.[0];
  if (!tag) return [];
  const classAttr = tag.match(/class="([^"]*)"/);
  return classAttr ? classAttr[1].split(/\s+/).filter(Boolean) : [];
}

describe('SearchDialog', () => {
  it('renders a 16px search input and safe-top dialog content', () => {
    const html = renderToStaticMarkup(
      createElement(SearchDialog, { open: true, onOpenChange: () => undefined }),
    );

    const inputClasses = classList(html, /<input\b[^>]*>/);
    expect(inputClasses).toContain('text-base');
    expect(inputClasses).not.toContain('text-sm');

    const contentClasses = classList(html, /<[^>]*role="dialog"[^>]*>/);
    expect(contentClasses).toContain('safe-top');
  });
});
