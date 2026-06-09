import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'destructive' | 'outline';

const variantClasses: Record<Variant, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/25',
  warning: 'bg-amber-500/15 text-amber-500 border border-amber-500/25',
  destructive: 'bg-destructive/15 text-destructive border border-destructive/25',
  outline: 'border border-border text-foreground',
};

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: Variant }) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
