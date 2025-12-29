import FaultyTerminal from "@/components/FaultyTerminal";

export default function Home() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <FaultyTerminal
        className="absolute inset-0"
        scanlineIntensity={0}
        tint="#8c9fb1"
        mouseReact={false}
        brightness={1}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/60" />

      <div className="absolute inset-0 grid place-items-center px-6">
        <main className="relative z-10 flex w-full max-w-4xl flex-col items-center gap-10 text-center">
          <button className="flex items-center gap-3 rounded-full border border-white/25 bg-white/10 px-6 py-3 text-lg font-semibold text-white shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/15">
            <span className="text-xl">⋮</span>
            New Background
          </button>

          <h1 className="text-4xl font-bold leading-[1.05] sm:text-5xl md:text-6xl">
            It works on my machine,
            <br className="hidden sm:block" />
            please check again
          </h1>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <button className="h-14 min-w-[180px] rounded-full bg-white px-8 text-lg font-semibold text-black shadow-xl transition hover:-translate-y-0.5 hover:shadow-2xl">
              Get Started
            </button>
            <button className="h-14 min-w-[180px] rounded-full border border-white/25 bg-white/10 px-8 text-lg font-semibold text-white shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/15">
              Learn More
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
