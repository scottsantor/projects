import * as React from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

type ListDetailContextValue = {
  showDetail: boolean;
  setShowDetail: (show: boolean) => void;
};

const ListDetailContext = React.createContext<ListDetailContextValue>({
  showDetail: false,
  setShowDetail: () => {},
});

function useListDetail() {
  return React.useContext(ListDetailContext);
}

function ListDetailLayout({ className, ...props }: React.ComponentProps<'div'>) {
  const [showDetail, setShowDetail] = React.useState(false);
  const value = React.useMemo(() => ({ showDetail, setShowDetail }), [showDetail]);

  return (
    <ListDetailContext.Provider value={value}>
      <div
        data-slot="list-detail-layout"
        className={cn('flex min-h-screen bg-background-primary', className)}
        {...props}
      />
    </ListDetailContext.Provider>
  );
}

function ListDetailLayoutHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="list-detail-layout-header"
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-background-primary px-4 sm:px-6 xl:px-8',
        className
      )}
      {...props}
    />
  );
}

function ListDetailLayoutList({ className, ...props }: React.ComponentProps<'aside'>) {
  const { showDetail } = useListDetail();

  return (
    <aside
      data-slot="list-detail-layout-list"
      className={cn(
        'w-full shrink-0 overflow-y-auto border-r md:w-80 lg:w-96 xl:w-[420px]',
        showDetail ? 'hidden md:block' : 'block',
        className
      )}
      {...props}
    />
  );
}

function ListDetailLayoutContent({
  className,
  children,
  ...props
}: React.ComponentProps<'main'>) {
  const { showDetail, setShowDetail } = useListDetail();

  return (
    <main
      data-slot="list-detail-layout-content"
      className={cn(
        'flex flex-1 flex-col overflow-y-auto',
        showDetail ? 'block' : 'hidden md:block',
        className
      )}
      {...props}
    >
      {showDetail && (
        <div className="flex items-center border-b p-2 md:hidden">
          <Button
            variant="ghost"
            shape="round"
            size="sm"
            onClick={() => setShowDetail(false)}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
        </div>
      )}
      {children}
    </main>
  );
}

function ListDetailLayoutEmpty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-detail-layout-empty"
      className={cn(
        'hidden flex-1 items-center justify-center text-text-secondary md:flex',
        className
      )}
      {...props}
    />
  );
}

export {
  ListDetailLayout,
  ListDetailLayoutHeader,
  ListDetailLayoutList,
  ListDetailLayoutContent,
  ListDetailLayoutEmpty,
  useListDetail,
};
