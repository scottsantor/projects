import * as React from 'react';
import { cn } from '../../lib/utils';

function DashboardLayout({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dashboard-layout"
      className={cn('flex min-h-screen flex-col bg-background-primary', className)}
      {...props}
    />
  );
}

function DashboardLayoutHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="dashboard-layout-header"
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-background-primary px-4 sm:px-6 xl:px-8',
        className
      )}
      {...props}
    />
  );
}

function DashboardLayoutMetrics({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="dashboard-layout-metrics"
      className={cn(
        'grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4 xl:gap-6 xl:p-8',
        className
      )}
      {...props}
    />
  );
}

function DashboardLayoutContent({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="dashboard-layout-content"
      className={cn('flex-1 px-4 pb-4 sm:px-6 sm:pb-6 xl:px-8 xl:pb-8', className)}
      {...props}
    />
  );
}

export {
  DashboardLayout,
  DashboardLayoutHeader,
  DashboardLayoutMetrics,
  DashboardLayoutContent,
};
