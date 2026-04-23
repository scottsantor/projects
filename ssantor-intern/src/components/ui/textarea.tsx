import * as React from 'react';
import { cn } from '../../lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        data-slot="textarea"
        className={cn(
          'flex min-h-20 w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-base',
          'text-text-primary placeholder:text-text-secondary placeholder:font-light',
          'hover:border-border-secondary focus:border-border-secondary',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors resize-none md:text-sm',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
