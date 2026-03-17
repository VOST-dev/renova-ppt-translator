import { TranslationListPage } from "./pages/TranslationListPage";

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Translator V2</h1>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <TranslationListPage />
      </main>
    </div>
  );
}

export default App;
