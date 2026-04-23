import * as React from 'react';
import { MenuIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Sheet, SheetContent } from '../ui/sheet';

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const SidebarContext = React.createContext<SidebarContextValue>({
  open: false,
  setOpen: () => {},
});

function useSidebar() {
  return React.useContext(SidebarContext);
}

function SidebarLayout({ className, ...props }: React.ComponentProps<'div'>) {
  const [open, setOpen] = React.useState(false);
  const value = React.useMemo(() => ({ open, setOpen }), [open]);

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-layout"
        className={cn('flex min-h-screen bg-background-primary', className)}
        {...props}
      />
    </SidebarContext.Provider>
  );
}

function SidebarLayoutSidebar({
  className,
  children,
  ...props
}: React.ComponentProps<'aside'>) {
  const { open, setOpen } = useSidebar();

  return (
    <>
      <aside
        data-slot="sidebar-layout-sidebar"
        className={cn(
          'hidden lg:flex lg:w-64 xl:w-72 lg:shrink-0 lg:flex-col lg:border-r bg-background-secondary',
          className
        )}
        {...props}
      >
        {children}
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-background-secondary">
          {children}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarLayoutNav({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      data-slot="sidebar-layout-nav"
      className={cn('flex flex-1 flex-col gap-1 overflow-y-auto p-4', className)}
      {...props}
    />
  );
}

function SidebarLayoutNavItem({
  className,
  active,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      data-slot="sidebar-layout-nav-item"
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left',
        active
          ? 'bg-background-tertiary text-text-primary font-medium'
          : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary',
        className
      )}
      {...props}
    />
  );
}

function SidebarLayoutBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-layout-body"
      className={cn('flex flex-1 flex-col', className)}
      {...props}
    />
  );
}

function SidebarLayoutHeader({
  className,
  children,
  ...props
}: React.ComponentProps<'header'>) {
  const { setOpen } = useSidebar();

  return (
    <header
      data-slot="sidebar-layout-header"
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-background-primary px-4 sm:px-6 xl:px-8',
        className
      )}
      {...props}
    >
      <Button
        variant="ghost"
        shape="round"
        size="sm"
        className="lg:hidden"
        onClick={() => setOpen(true)}
      >
        <MenuIcon className="size-5" />
      </Button>
      {children}
    </header>
  );
}

function SidebarLayoutContent({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-layout-content"
      className={cn('flex-1 p-4 sm:p-6 xl:p-8', className)}
      {...props}
    />
  );
}

export {
  SidebarLayout,
  SidebarLayoutSidebar,
  SidebarLayoutNav,
  SidebarLayoutNavItem,
  SidebarLayoutBody,
  SidebarLayoutHeader,
  SidebarLayoutContent,
  useSidebar,
};
