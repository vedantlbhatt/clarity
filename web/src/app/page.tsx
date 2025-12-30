import FaultyTerminal from "@/components/FaultyTerminal";
import CallStarter from "@/components/CallStarter";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Fixed background layer */}
      <div className="fixed inset-0 overflow-hidden">
        <FaultyTerminal
          className="absolute inset-0"
          scanlineIntensity={0}
          tint="#8a90f0"
          mouseReact={false}
          brightness={1}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/25 to-black/35" />
      </div>

      {/* Scrollable content */}
      <div className="relative z-10">
        <section className="flex min-h-screen items-center justify-center px-3">
          <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
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
          </div>
        </section>

        {/* Combined glass panel section */}
        <section className="px-0 pb-20">
          <div className="flex w-full flex-col gap-8 rounded-none border-y border-white/12 bg-black/80 p-10 text-left shadow-2xl backdrop-blur-lg md:p-14">
            <div className="flex flex-col gap-3">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">
                Why this matters
              </p>
              <h2 className="text-2xl font-semibold text-white">
                Practice speaking with an always-on, dialable AI partner
              </h2>
              <p className="text-slate-300">
                Speak naturally, get immediate feedback, and iterate quickly. The background stays fixed for visual continuity while you scroll through the story.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">
                Dialable Ultravox agent controls
              </p>
              <h3 className="text-xl font-semibold text-white">Adjust the call experience before you connect</h3>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-white" htmlFor="context">
                    Overall context / system prompt
                  </label>
                  <textarea
                    id="context"
                    className="min-h-[96px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-white/40 focus:outline-none"
                    placeholder="e.g., You are a supportive voice coach that gives concise, actionable feedback."
                  />
                  <p className="text-xs text-slate-400">
                    Sets persona, guardrails, and tone for the conversation.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-white" htmlFor="interruption">
                    Interruption rules
                  </label>
                  <select
                    id="interruption"
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                    defaultValue="medium"
                  >
                    <option value="allow-fast">Allow barge-in (high sensitivity)</option>
                    <option value="medium">Allow barge-in (normal)</option>
                    <option value="strict">No barge-in (finish responses)</option>
                  </select>
                  <p className="text-xs text-slate-400">
                    Controls whether the agent can be interrupted and how quickly it yields.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-white" htmlFor="coaching-style">
                    Coaching style
                  </label>
                  <select
                    id="coaching-style"
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                    defaultValue="realtime"
                  >
                    <option value="realtime">Real-time coaching</option>
                    <option value="after-call">After-call summary</option>
                    <option value="every-mistake">After every mistake</option>
                    <option value="interval">At intervals</option>
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300">Strictness</label>
                      <select className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white focus:border-white/40 focus:outline-none" defaultValue="medium">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-300">Feedback level</label>
                      <select className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white focus:border-white/40 focus:outline-none" defaultValue="balanced">
                        <option value="concise">Concise</option>
                        <option value="balanced">Balanced</option>
                        <option value="detailed">Detailed</option>
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    Choose when feedback arrives and how hard the agent pushes.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-white" htmlFor="logging">
                    Logging granularity
                  </label>
                  <select
                    id="logging"
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                    defaultValue="medium"
                  >
                    <option value="minimal">Minimal (totals only)</option>
                    <option value="medium">Turn-level (transcript + timing)</option>
                    <option value="detailed">Detailed (per-utterance, ASR confidences)</option>
                  </select>
                  <p className="text-xs text-slate-400">
                    Minimal: high-level stats. Turn-level: transcript/timing. Detailed: per-utterance metrics.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button className="h-11 rounded-full bg-white px-6 text-sm font-semibold text-black shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl">
                  Apply Settings
                </button>
                <button className="h-11 rounded-full border border-white/25 bg-white/5 px-6 text-sm font-semibold text-white shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/10">
                  Save as Preset
                </button>
              </div>

              <div className="pt-4">
                <CallStarter />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
