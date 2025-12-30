"use client";

import { useState } from "react";

export default function CallStarter() {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const startCall = async () => {
    if (!phone.trim()) {
      setMessage("Enter a phone number.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("success");
      setMessage("Calling... check your phone.");
    } catch (err) {
      setStatus("error");
      setMessage("Failed to start call. Check server logs.");
    }
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left shadow-lg backdrop-blur-md">
      <p className="text-sm font-semibold text-white">Dial me now (Ultravox)</p>
      <p className="text-xs text-slate-400">
        Enter your number and start a call routed through the Ultravox agent.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
          placeholder="e.g., +1 555 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button
          onClick={startCall}
          disabled={status === "loading"}
          className="h-10 rounded-full bg-white px-5 text-sm font-semibold text-black shadow-md transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "loading" ? "Calling..." : "Call Me"}
        </button>
      </div>
      {message && (
        <p
          className={`text-xs ${
            status === "error" ? "text-rose-300" : "text-slate-300"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

