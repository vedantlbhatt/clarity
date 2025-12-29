import FaultyTerminal from "@/components/FaultyTerminal";

export default function Home() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <FaultyTerminal
        className="absolute inset-0"
        scanlineIntensity={0}
        tint="#8a90f0"
        mouseReact={false}
        brightness={1}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/60" />

      <div className="absolute inset-0 grid place-items-center px-3">
        <main className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-6 text-center">
          <button className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/15">
            <span className="text-base">⋮</span>
            New Background
          </button>

          <h1 className="text-2xl font-semibold leading-tight sm:text-3xl md:text-4xl">
            Dialable AI Voice Agent
            <br className="hidden sm:block" />
            with Real-Time Feedback
          </h1>

          <div className="flex flex-col items-center gap-2.5 sm:flex-row sm:gap-4">
            <button className="h-10 min-w-[140px] rounded-full bg-white px-5 text-sm font-semibold text-black shadow-xl transition hover:-translate-y-0.5 hover:shadow-2xl">
              Get Started
            </button>
            <button className="h-10 min-w-[140px] rounded-full border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/15">
              Learn More
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
