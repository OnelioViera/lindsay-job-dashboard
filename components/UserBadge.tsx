"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

/** Who is signed in: full name if the account has one, otherwise the part of the email before the @. */
export default function UserBadge() {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setPw("");
    setPw2("");
    setMsg(null);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8)
      return setMsg({ ok: false, text: "Use at least 8 characters." });
    if (pw !== pw2)
      return setMsg({ ok: false, text: "The two passwords don't match." });
    setBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw("");
    setPw2("");
    setMsg({ ok: true, text: "Password changed." });
  };

  useEffect(() => {
    const supabase = getSupabase();
    const show = (
      user: {
        email?: string | null;
        user_metadata?: Record<string, unknown>;
      } | null,
    ) => {
      if (!user) return setName("");
      const meta = user.user_metadata ?? {};
      const full = (meta.full_name ?? meta.name ?? meta.display_name) as
        string | undefined;
      const local = (user.email ?? "").split("@")[0].replace(/[._-]+/g, " ");
      const nice = local.replace(/\b\w/g, (c) => c.toUpperCase());
      setName(full?.trim() || nice);
    };
    supabase.auth.getUser().then(({ data }) => show(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      show(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!name) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Signed in as — click to change your password"
        className="rounded-md bg-navy/10 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/20 print:hidden"
      >
        {name}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
          <form
            onSubmit={save}
            className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-navy">Change password</h2>
            <p className="text-sm text-slate-600">Signed in as {name}.</p>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Type it again"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy focus:outline-none"
            />
            {msg && (
              <p
                className={`text-sm ${msg.ok ? "text-green-700" : "text-brand-red"}`}
              >
                {msg.text}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                {msg?.ok ? "Close" : "Cancel"}
              </button>
              <button
                type="submit"
                disabled={busy || msg?.ok}
                className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save password"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
