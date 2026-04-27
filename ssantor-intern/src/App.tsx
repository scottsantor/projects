import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Home } from './components/features/Home'
import { CreateTicket } from './components/features/CreateTicket'
import { MyTickets } from './components/features/MyTickets'
import { ClaudeCost } from './components/features/ClaudeCost'
import { Todos } from './components/features/Todos'
import { Notepad } from './components/features/Notepad'
import { PolishWriteup } from './components/features/PolishWriteup'
import { Scratch } from './components/features/Scratch'
import { Links } from './components/features/Links'

function App() {
  const [tab, setTab] = useState('home')

  return (
    <div className="min-h-screen bg-background-primary text-text-primary">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Scott's Intern</h1>
          <p className="text-sm text-text-secondary mt-1">
            One-stop shop for Scott to stay on top of his work — tickets, todos, meeting notes, costs, and quick links, all in one place.
          </p>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList>
            <TabsTrigger value="home">Home</TabsTrigger>
            <TabsTrigger value="create">Create Ticket</TabsTrigger>
            <TabsTrigger value="mine">My Work</TabsTrigger>
            <TabsTrigger value="notepad">Meeting Notes</TabsTrigger>
            <TabsTrigger value="polish">Polish Writeup</TabsTrigger>
            <TabsTrigger value="cost">Claude Cost</TabsTrigger>
            <TabsTrigger value="links">Links</TabsTrigger>
            <TabsTrigger value="scratch">Scratch</TabsTrigger>
          </TabsList>

          <TabsContent value="home" forceMount className="data-[state=inactive]:hidden">
            <Home onNavigate={setTab} />
          </TabsContent>

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

          <TabsContent value="polish" forceMount className="data-[state=inactive]:hidden">
            <PolishWriteup />
          </TabsContent>

          <TabsContent value="cost" forceMount className="data-[state=inactive]:hidden">
            <ClaudeCost />
          </TabsContent>

          <TabsContent value="links" forceMount className="data-[state=inactive]:hidden">
            <Links />
          </TabsContent>

          <TabsContent value="scratch" forceMount className="data-[state=inactive]:hidden">
            <Scratch />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App
