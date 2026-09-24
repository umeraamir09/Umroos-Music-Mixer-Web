import { AppHeader } from "@/components/app-header";
import { PromptComposer } from "@/components/prompt-composer";

export default function MixPage() {
  return (
    <main className="app-shell">
      <AppHeader />
      <PromptComposer />
    </main>
  );
}
