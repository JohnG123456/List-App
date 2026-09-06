"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Shield, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AllowedEmail, Household, List, Member } from "@/lib/types";
import { initialsFromEmail } from "@/lib/display";

/**
 * Everything you set once and then forget. It lives on its own screen because
 * the main screen is for the lists: a panel that gets opened twice a year was
 * taking the most valuable space on the page.
 */
export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const [allowedEmails, setAllowedEmails] = useState<AllowedEmail[]>([]);
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [userResult, householdResult, membersResult, listsResult] =
        await Promise.all([
          supabase.auth.getUser(),
          supabase.from("households").select("*").limit(1).maybeSingle(),
          supabase.from("household_members").select("*"),
          supabase.from("lists").select("*").order("position", { ascending: true }),
        ]);

      if (cancelled) return;

      const user = userResult.data.user;
      setUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);
      setHousehold(householdResult.data ?? null);
      setMembers(membersResult.data ?? []);
      setLists(listsResult.data ?? []);

      const me = (membersResult.data ?? []).find((m) => m.user_id === user?.id);
      setIsOwner(Boolean(me?.is_owner));
      setLoading(false);

      if (me?.is_owner) {
        const { data } = await supabase
          .from("allowed_emails")
          .select("id, email")
          .order("created_at", { ascending: true });
        if (!cancelled) setAllowedEmails(data ?? []);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function addAllowedEmail(e: React.FormEvent) {
    e.preventDefault();
    const email = newAllowedEmail.trim().toLowerCase();
    if (!email) return;

    const { data, error: insertError } = await supabase
      .from("allowed_emails")
      .insert({ email })
      .select("id, email")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }
    setAllowedEmails((prev) => [...prev, data]);
    setNewAllowedEmail("");
  }

  async function removeAllowedEmail(entry: AllowedEmail) {
    if (!window.confirm(`Remove access for ${entry.email}?`)) return;
    const { error: deleteError } = await supabase
      .from("allowed_emails")
      .delete()
      .eq("id", entry.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setAllowedEmails((prev) => prev.filter((e) => e.id !== entry.id));
  }

  const section = "space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4 backdrop-blur";
  const heading = "text-sm font-semibold text-slate-100";
  const caption = "text-xs text-slate-500";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Back to your lists"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : (
        <>
          <div className={section}>
            <p className={heading}>Household</p>
            <p className={caption}>
              The people here share every list that isn&rsquo;t marked private, and
              share these settings.
            </p>
            <div className="space-y-1">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2 text-sm text-slate-200"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/25 text-[10px] text-blue-100">
                    {member.initials ??
                      (member.user_id === userId && userEmail
                        ? initialsFromEmail(userEmail)
                        : "?")}
                  </span>
                  {member.user_id === userId ? (userEmail ?? "You") : "Household member"}
                  {member.is_owner && (
                    <span className="ml-auto text-xs text-slate-500">owner</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className={section}>
            <p className={heading}>Streaming services</p>
            <p className={caption}>
              What dictated service names get snapped to, so one service never
              becomes three spellings.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(household?.services ?? []).map((service) => (
                <span
                  key={service}
                  className="rounded-lg border border-slate-700 bg-slate-800/40 px-2 py-1 text-xs text-slate-300"
                >
                  {service}
                </span>
              ))}
            </div>
          </div>

          <div className={section}>
            <p className={heading}>Supermarket order</p>
            <p className={caption}>
              Groceries sort into these sections, in this order, so the list
              matches the walk through the shop.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(household?.aisle_order ?? []).map((aisle, i) => (
                <span
                  key={aisle}
                  className="rounded-lg border border-slate-700 bg-slate-800/40 px-2 py-1 text-xs text-slate-300"
                >
                  <span className="text-slate-500">{i + 1}.</span> {aisle}
                </span>
              ))}
            </div>
          </div>

          <div className={section}>
            <p className={heading}>Lists</p>
            <div className="space-y-1">
              {lists.map((list) => (
                <div
                  key={list.id}
                  className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2 text-sm text-slate-200"
                >
                  {list.name}
                  <span className="ml-auto text-xs text-slate-500">
                    {list.private_to ? "private" : "shared"}
                    {list.is_archive ? " · archive" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {isOwner && (
            <div className={section}>
              <p className={`${heading} flex items-center gap-2`}>
                <Shield className="h-4 w-4 text-slate-400" />
                Who can sign up ({allowedEmails.length})
              </p>
              <p className={caption}>
                Only these addresses can create an account.
              </p>

              <form onSubmit={addAllowedEmail} className="flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="Email to allow"
                  value={newAllowedEmail}
                  onChange={(e) => setNewAllowedEmail(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white"
                >
                  Add
                </button>
              </form>

              <div className="space-y-1">
                {allowedEmails.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2 text-sm text-slate-200"
                  >
                    {entry.email}
                    <button
                      onClick={() => removeAllowedEmail(entry)}
                      aria-label={`Remove access for ${entry.email}`}
                      className="shrink-0 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className={caption}>
            Editing these is coming. For now they are set in the database, and
            the README covers how.
          </p>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </>
      )}
    </main>
  );
}
