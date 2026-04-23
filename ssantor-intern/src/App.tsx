import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { CreateTicket } from './components/features/CreateTicket'
import { MyTickets } from './components/features/MyTickets'
import { ClaudeCost } from './components/features/ClaudeCost'
import { Todos } from './components/features/Todos'
import { Notepad } from './components/features/Notepad'
import { Links } from './components/features/Links'

function App() {
  return (
    <div className="min-h-screen bg-background-primary text-text-primary">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Scott's Intern</h1>
          <p className="text-sm text-text-secondary mt-1">
            Linear cockpit — create CUSTDS tickets and track what's assigned to you.
          </p>
        </header>

        <Tabs defaultValue="create" className="w-full">
          <TabsList>
            <TabsTrigger value="create">Create Ticket</TabsTrigger>
            <TabsTrigger value="mine">My Work</TabsTrigger>
            <TabsTrigger value="notepad">Notepad</TabsTrigger>
            <TabsTrigger value="cost">Claude Cost</TabsTrigger>
            <TabsTrigger value="links">Links</TabsTrigger>
          </TabsList>

          <TabsContent value="create" forceMount className="data-[state=inactive]:hidden">
            <CreateTicket />
          </TabsContent>

          <TabsContent value="mine" forceMount className="data-[state=inactive]:hidden">
            <div className="flex flex-col gap-8">
              <MyTickets />
              <div className="h-px bg-border-primary" />
              <Todos />
            </div>
          </TabsContent>

          <TabsContent value="notepad" forceMount className="data-[state=inactive]:hidden">
            <Notepad />
          </TabsContent>

          <TabsContent value="cost" forceMount className="data-[state=inactive]:hidden">
            <ClaudeCost />
          </TabsContent>

          <TabsContent value="links" forceMount className="data-[state=inactive]:hidden">
            <Links />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App
