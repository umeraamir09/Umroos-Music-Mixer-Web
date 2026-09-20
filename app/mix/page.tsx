import { AppHeader } from "@/components/app-header";
import { PromptComposer } from "@/components/prompt-composer";

export default function MixPage() {
  return (
    <main className="app-shell min-h-screen">
      <AppHeader />
      <section className="prompt-stage">
        <div className="text-center">
          <p className="eyebrow mb-5">AI playlist maker</p>
          <h1 className="page-title">Good music<br />starts with a feeling<span className="accent-dot">.</span></h1>
          <p className="page-subtitle">Describe the vibe, mood, or moment — and I&apos;ll craft a playlist for you.</p>
        </div>
        <PromptComposer />
      </section>
    </main>
  );
}
