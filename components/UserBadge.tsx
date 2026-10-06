"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

/** Who is signed in: full name if the account has one, otherwise the part of the email before the @. */
export default function UserBadge() {
  const [name, setName] = useState("");

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
    <span
      title="Signed in as"
      className="rounded-md bg-navy/10 px-3 py-2 text-sm font-semibold text-navy print:hidden"
    >
      {name}
    </span>
  );
}
