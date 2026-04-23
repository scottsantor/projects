import * as React from 'react';
import { cn } from '../../lib/utils';

function StackedLayout({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="stacked-layout"
      className={cn('flex min-h-screen flex-col bg-background-primary', className)}
      {...props}
    />
  );
}

function StackedLayoutHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="stacked-layout-header"
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-background-primary px-4 sm:px-6 xl:px-8',
        className
      )}
      {...props}
    />
  );
}

function StackedLayoutContent({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="stacked-layout-content"
      className={cn('flex-1 p-4 sm:p-6 xl:p-8', className)}
      {...props}
    />
  );
}

function StackedLayoutFooter({ className, ...props }: React.ComponentProps<'footer'>) {
  return (
    <footer
      data-slot="stacked-layout-footer"
      className={cn(
        'flex shrink-0 items-center border-t bg-background-primary px-4 py-3 sm:px-6 xl:px-8',
        className
      )}
      {...props}
    />
  );
}

export { StackedLayout, StackedLayoutHeader, StackedLayoutContent, StackedLayoutFooter };
