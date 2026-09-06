"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, Shield, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AllowedEmail, Household, List, Member } from "@/lib/types";
import { initialsFromEmail } from "@/lib/display";
import ChipEditor from "@/components/ChipEditor";

/**
 * Everything you set once and then forget. It lives on its own screen because
 * the main screen is for the lists: a panel opened twice a year shouldn't sit
 * above them.
 *
 * Every change saves as you make it. There is no Save button because there is
 * nothing here you would want to fill in and then abandon.
 */
export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<List[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  const [allowedEmails, setAllowedEmails] = useState<AllowedEmail[]>([]);
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [userResult, householdResult, membersResult, listsResult, emailResult] =
        await Promise.all([
          supabase.auth.getUser(),
          supabase.from("households").select("*").limit(1).maybeSingle(),
          supabase.from("household_members").select("*"),
          supabase.from("lists").select("*").order("position", { ascending: true }),
          supabase.rpc("household_member_emails"),
        ]);

      if (cancelled) return;

      const user = userResult.data.user;
      setUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);
      setHousehold(householdResult.data ?? null);
      setMembers(membersResult.data ?? []);
      setLists(listsResult.data ?? []);

      const lookup: Record<string, string> = {};
      for (const row of (emailResult.data ?? []) as { user_id: string; email: string }[]) {
        lookup[row.user_id] = row.email;
      }
      setEmails(lookup);

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

  function flash(message: string) {
    setSaved(message);
    setTimeout(() => setSaved(null), 1800);
  }

  /** Saves one household setting, putting the old value back if it fails. */
  async function saveHousehold(patch: Partial<Household>, label: string) {
    if (!household) return;
    const previous = household;
    setHousehold({ ...household, ...patch });

    const { error: updateError } = await supabase
      .from("households")
      .update(patch)
      .eq("id", household.id);

    if (updateError) {
      setError(updateError.message);
      setHousehold(previous);
      return;
    }
    flash(`${label} saved`);
  }

  async function saveList(list: List, patch: Partial<List>, label: string) {
    const previous = lists;
    setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, ...patch } : l)));

    const { error: updateError } = await supabase
      .from("lists")
      .update(patch)
      .eq("id", list.id);

    if (updateError) {
      setError(updateError.message);
      setLists(previous);
      return;
    }
    flash(label);
  }

  /** Swaps two lists' positions, so the pill order is yours to choose. */
  async function moveList(list: List, by: number) {
    const ordered = [...lists].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((l) => l.id === list.id);
    const target = ordered[index + by];
    if (!target) return;

    const swapped = ordered.map((l) =>
      l.id === list.id
        ? { ...l, position: target.position }
        : l.id === target.id
          ? { ...l, position: list.position }
          : l
    );
    setLists(swapped);

    const results = await Promise.all([
      supabase.from("lists").update({ position: target.position }).eq("id", list.id),
      supabase.from("lists").update({ position: list.position }).eq("id", target.id),
    ]);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(failed.error.message);
      setLists(lists);
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const email = newMemberEmail.trim().toLowerCase();
    if (!email) return;

    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("add_household_member", {
      member_email: email,
    });

    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setNewMemberEmail("");
    flash("Added to your household");
    // Membership changes what every other query returns, so reload rather than
    // trying to patch the pieces back together.
    window.location.reload();
  }

  async function removeMember(member: Member) {
    const who = emails[member.user_id] ?? "this person";
    if (
      !window.confirm(
        `Remove ${who} from your household? They'll lose access to the shared lists, and anything private to them stays hidden.`
      )
    ) {
      return;
    }

    const { error: rpcError } = await supabase.rpc("remove_household_member", {
      member_user_id: member.user_id,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id));
    flash("Removed");
  }

  async function saveInitials(value: string) {
    const initials = value.trim().toUpperCase().slice(0, 3);
    if (!userId || !initials) return;
    const me = members.find((m) => m.user_id === userId);
    if (!me) return;

    setMembers((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, initials } : m))
    );

    const { error: updateError } = await supabase
      .from("household_members")
      .update({ initials })
      .eq("household_id", me.household_id)
      .eq("user_id", userId);

    if (updateError) setError(updateError.message);
    else flash("Initials saved");
  }

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

  const section =
    "space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4 backdrop-blur";
  const heading = "text-sm font-semibold text-slate-100";
  const caption = "text-xs text-slate-500";
  const me = members.find((m) => m.user_id === userId);
  const orderedLists = [...lists].sort((a, b) => a.position - b.position);

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
        {saved && <span className="ml-auto text-xs text-green-400">{saved}</span>}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : !household ? (
        <p className="text-sm text-slate-400">
          You&rsquo;re not in a household yet. Ask whoever set this up to add your
          email here.
        </p>
      ) : (
        <>
          <div className={section}>
            <p className={heading}>Household</p>
            <p className={caption}>
              Everyone here shares every list that isn&rsquo;t private, and shares
              these settings.
            </p>

            <div className="space-y-1">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-2 text-sm text-slate-200"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/25 text-[10px] text-blue-100">
                    {member.initials ??
                      (emails[member.user_id]
                        ? initialsFromEmail(emails[member.user_id])
                        : "?")}
                  </span>
                  <span className="truncate">
                    {emails[member.user_id] ?? "Household member"}
                  </span>
                  {member.is_owner && (
                    <span className="ml-auto shrink-0 text-xs text-slate-500">owner</span>
                  )}
                  {isOwner && !member.is_owner && (
                    <button
                      onClick={() => removeMember(member)}
                      aria-label="Remove from household"
                      className="ml-auto shrink-0 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {me && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                Your initials
                <input
                  defaultValue={
                    me.initials ?? (userEmail ? initialsFromEmail(userEmail) : "")
                  }
                  onBlur={(e) => saveInitials(e.target.value)}
                  maxLength={3}
                  className="w-16 rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1 text-center text-sm uppercase text-slate-100 outline-none focus:border-blue-500"
                />
                <span className={caption}>shown against shared items</span>
              </label>
            )}

            {isOwner && (
              <form onSubmit={addMember} className="flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="Add someone by email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Adding..." : "Add"}
                </button>
              </form>
            )}
            {isOwner && (
              <p className={caption}>
                They need an account first, and their email on the sign-up list
                below.
              </p>
            )}
          </div>

          <div className={section}>
            <p className={heading}>Streaming services</p>
            <p className={caption}>
              What dictated service names are snapped to, so one service never
              becomes three spellings.
            </p>
            <ChipEditor
              values={household.services}
              placeholder="Netflix, Stan, Binge..."
              onChange={(services) => saveHousehold({ services }, "Services")}
            />
          </div>

          <div className={section}>
            <p className={heading}>Viewing profiles</p>
            <p className={caption}>
              Whose profile a show was watched on, which the streaming apps
              can&rsquo;t tell you.
            </p>
            <ChipEditor
              values={household.profiles}
              placeholder="Ours, Kids..."
              onChange={(profiles) => saveHousehold({ profiles }, "Profiles")}
            />
          </div>

          <div className={section}>
            <p className={heading}>Supermarket order</p>
            <p className={caption}>
              Groceries sort into these sections, in this order, so the list
              matches the walk through your shop.
            </p>
            <ChipEditor
              values={household.aisle_order}
              placeholder="Produce, Bakery, Dairy..."
              ordered
              onChange={(aisle_order) => saveHousehold({ aisle_order }, "Aisle order")}
            />
          </div>

          <div className={section}>
            <p className={heading}>Lists</p>
            <p className={caption}>
              Lists sharing a pill name appear as sections on one screen. The
              order here is the order of the pills.
            </p>
            <div className="space-y-2">
              {orderedLists.map((list, i) => (
                <div
                  key={list.id}
                  className="space-y-2 rounded-lg border border-slate-700/60 bg-slate-800/30 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={list.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== list.name) saveList(list, { name }, "Renamed");
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1 text-sm text-slate-100 outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() => moveList(list, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${list.name} up`}
                      className="text-slate-500 hover:text-blue-300 disabled:opacity-25"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => moveList(list, 1)}
                      disabled={i === orderedLists.length - 1}
                      aria-label={`Move ${list.name} down`}
                      className="text-slate-500 hover:text-blue-300 disabled:opacity-25"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      defaultValue={list.group_name}
                      onBlur={(e) => {
                        const group_name = e.target.value.trim();
                        if (group_name && group_name !== list.group_name) {
                          saveList(list, { group_name }, "Pill changed");
                        }
                      }}
                      aria-label={`Pill name for ${list.name}`}
                      className="w-28 rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300 outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() => {
                        // Going private hides the list from everyone else,
                        // including from whoever else was using it, and only
                        // the person who did it can put it back.
                        if (
                          !list.private_to &&
                          !window.confirm(
                            `Make "${list.name}" private to you? Nobody else in the household will see it, or be able to share it again.`
                          )
                        ) {
                          return;
                        }
                        saveList(
                          list,
                          { private_to: list.private_to ? null : userId },
                          list.private_to ? "Now shared" : "Now private"
                        );
                      }}
                      className={`rounded-full border px-2.5 py-1 ${
                        list.private_to
                          ? "border-slate-600 bg-slate-700/40 text-slate-300"
                          : "border-pink-500/40 bg-pink-500/10 text-pink-200"
                      }`}
                    >
                      {list.private_to ? "Private to you" : "Shared"}
                    </button>
                    {list.is_archive && (
                      <span className="text-slate-500">archive</span>
                    )}
                  </div>
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

          {error && <p className="text-sm text-red-400">{error}</p>}
        </>
      )}
    </main>
  );
}
