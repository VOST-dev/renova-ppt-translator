import { useState } from "react";
import { CreateTranslationPage } from "./pages/CreateTranslationPage";
import { TranslationListPage } from "./pages/TranslationListPage";

function App() {
  const [view, setView] = useState<"list" | "create">("list");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Translator V2</h1>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        {view === "list" ? (
          <TranslationListPage onNavigateCreate={() => setView("create")} />
        ) : (
          <CreateTranslationPage onNavigateList={() => setView("list")} />
        )}
      </main>
    </div>
  );
}

export default App;
