"use client";

import { useEffect, useState } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) {
      setReady(true);
      return;
    }
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <img
          src="/logo.png"
          alt="Lindsay Precast"
          className="mb-6 h-24 w-auto"
        />
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="mb-2 font-semibold">
            Supabase isn&apos;t connected yet.
          </p>
          <p>
            Copy{" "}
            <code className="rounded bg-white px-1">.env.local.example</code> to{" "}
            <code className="rounded bg-white px-1">.env.local</code>, fill in
            your Supabase URL and anon key, then restart the dev server. On
            Vercel, add the same two variables under Project Settings →
            Environment Variables.
          </p>
        </div>
      </main>
    );
  }

  if (!ready) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  }

  if (!signedIn) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const { error } = await getSupabase().auth.signInWithPassword({
        email,
        password,
      });
      if (error) setError(error.message);
      setBusy(false);
    };

    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
        <img
          src="/logo.png"
          alt="Lindsay Precast"
          className="mx-auto mb-6 h-32 w-auto"
        />
        <form
          onSubmit={submit}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h1 className="text-lg font-semibold text-navy">
            Lindsay Precast sign in
          </h1>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20"
          />
          {error && <p className="text-sm text-brand-red">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  return <>{children}</>;
}
