import * as React from 'react';
import { cn } from '../../lib/utils';

function CenteredLayout({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="centered-layout"
      className={cn('flex min-h-screen flex-col bg-background-primary', className)}
      {...props}
    />
  );
}

function CenteredLayoutHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="centered-layout-header"
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-background-primary px-4 sm:px-6 xl:px-8',
        className
      )}
      {...props}
    />
  );
}

function CenteredLayoutContent({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="centered-layout-content"
      className={cn('mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6 lg:p-8 xl:max-w-3xl', className)}
      {...props}
    />
  );
}

function CenteredLayoutFooter({ className, ...props }: React.ComponentProps<'footer'>) {
  return (
    <footer
      data-slot="centered-layout-footer"
      className={cn(
        'mx-auto flex w-full max-w-2xl shrink-0 items-center px-4 py-3 sm:px-6 lg:px-8 xl:max-w-3xl',
        className
      )}
      {...props}
    />
  );
}

export { CenteredLayout, CenteredLayoutHeader, CenteredLayoutContent, CenteredLayoutFooter };
