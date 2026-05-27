'use client';

import { TrendingDown } from 'lucide-react';
import type { ReactNode } from 'react';

interface StepLayoutProps {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function StepLayout({ step, totalSteps, title, subtitle, children, footer }: StepLayoutProps) {
  const percent = Math.round((step / totalSteps) * 100);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-white/[0.06] px-4 py-4 sm:px-8">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <TrendingDown className="h-6 w-6 text-primary" />
          <span className="text-lg font-headline font-extrabold text-primary">Hoard</span>
          <span className="ml-auto text-xs font-label font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Setup · Step {step} of {totalSteps}
          </span>
        </div>
        <div className="max-w-2xl mx-auto mt-3 h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-xl bg-card p-6 sm:p-8 shadow-lg">
            <h1 className="text-2xl font-headline font-extrabold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
            )}
            <div className="mt-6 space-y-4">{children}</div>
          </div>
          {footer && (
            <div className="mt-6 flex items-center justify-between gap-3">{footer}</div>
          )}
        </div>
      </main>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-md border border-white/[0.08] bg-transparent px-5 py-2.5 text-sm font-medium text-foreground hover:bg-white/[0.04] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
