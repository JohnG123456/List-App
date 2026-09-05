"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ListChecks,
  Mail,
  Mic,
  Shield,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  AllowedEmail,
  Household,
  Item,
  ItemUpdate,
  List,
  Member,
  NewItem,
} from "@/lib/types";
import {
  groupItems,
  groupNames,
  initialsFor,
  initialsFromEmail,
  isSnoozed,
  listsInGroup,
} from "@/lib/display";
import PillRail from "@/components/PillRail";
import ItemRow from "@/components/ItemRow";

// How long a ticked item stays in the open list, crossed out, before it moves
// to the done section. Long enough to see it happen.
const COMPLETED_HOLD_MS = 1000;

// How long newly added items keep their green NEW state after you open the
// list they landed in.
const FRESH_HOLD_MS = 2600;

const LAST_GROUP_KEY = "list-app:last-group";

const CREATE_LIST_TRIGGERS = [
  "create the list",
  "create my list",
  "create list",
  "make the list",
  "make my list",
  "make list",
  "that's it",
  "thats it",
];

// Looks for a spoken stop-and-submit phrase and strips it out. Longer phrases
// are checked first so e.g. "create my list" doesn't leave a stray "my".
function extractSubmitTrigger(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of CREATE_LIST_TRIGGERS) {
    const index = lower.indexOf(phrase);
    if (index !== -1) {
      const cleaned = (text.slice(0, index) + text.slice(index + phrase.length)).trim();
      return { triggered: true, cleaned };
    }
  }
  return { triggered: false, cleaned: text };
}

type Receipt = {
  message: string;
  jumps: { group: string; label: string }[];
  undo: () => void | Promise<void>;
};

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [lists, setLists] = useState<List[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  const [activeGroup, setActiveGroup] = useState<string>("");
  const [showDone, setShowDone] = useState<Record<string, boolean>>({});
  const [settlingIds, setSettlingIds] = useState<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [freshListIds, setFreshListIds] = useState<Set<string>>(new Set());

  const [dictation, setDictation] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);

  const [allowedEmails, setAllowedEmails] = useState<AllowedEmail[]>([]);
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Dictation is started once and runs for minutes. Without this the voice
  // submit would call the handler captured on the render that started it,
  // which has stale items and no signed-in user.
  const captureRef = useRef<(text: string) => Promise<void>>(async () => {});
  const shouldRecordRef = useRef(false);
  const dictationRef = useRef("");
  const activeGroupRef = useRef("");
  const settleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = settleTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    activeGroupRef.current = activeGroup;
    if (activeGroup) {
      try {
        window.localStorage.setItem(LAST_GROUP_KEY, activeGroup);
      } catch {
        // Private browsing can refuse storage; remembering the last list is a
        // convenience, not something worth failing over.
      }
    }
  }, [activeGroup]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const [userResult, listsResult, itemsResult, householdResult, membersResult] =
        await Promise.all([
          supabase.auth.getUser(),
          supabase.from("lists").select("*").order("position", { ascending: true }),
          supabase
            .from("items")
            .select("*")
            .is("archived_at", null)
            .order("created_at", { ascending: true }),
          supabase.from("households").select("*").limit(1).maybeSingle(),
          supabase.from("household_members").select("*"),
        ]);

      if (cancelled) return;

      const user = userResult.data.user;
      setUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);

      const firstError = listsResult.error ?? itemsResult.error;
      if (firstError) setError(firstError.message);

      const loadedLists = listsResult.data ?? [];
      setLists(loadedLists);
      setItems(itemsResult.data ?? []);
      setHousehold(householdResult.data ?? null);

      const loadedMembers = membersResult.data ?? [];
      setMembers(loadedMembers);

      const me = loadedMembers.find((m) => m.user_id === user?.id);
      setIsOwner(Boolean(me?.is_owner));

      // Fill in your own initials the first time, so shared lists have
      // something to show against your name without a settings trip.
      if (me && !me.initials && user?.email) {
        const initials = initialsFromEmail(user.email);
        await supabase
          .from("household_members")
          .update({ initials })
          .eq("household_id", me.household_id)
          .eq("user_id", user.id);
        if (!cancelled) {
          setMembers((prev) =>
            prev.map((m) => (m.user_id === user.id ? { ...m, initials } : m))
          );
        }
      }

      const names = groupNames(loadedLists);
      let remembered: string | null = null;
      try {
        remembered = window.localStorage.getItem(LAST_GROUP_KEY);
      } catch {
        remembered = null;
      }
      setActiveGroup(
        remembered && names.includes(remembered) ? remembered : (names[0] ?? "")
      );

      setLoading(false);

      if (me?.is_owner) {
        const { data } = await supabase
          .from("allowed_emails")
          .select("id, email")
          .order("created_at", { ascending: true });
        if (!cancelled) setAllowedEmails(data ?? []);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // New items hold their green state until you actually open the list they
  // landed in, then settle a couple of seconds later.
  useEffect(() => {
    if (!activeGroup || freshListIds.size === 0) return;
    const visible = listsInGroup(lists, activeGroup).map((l) => l.id);
    if (!visible.some((id) => freshListIds.has(id))) return;

    const timer = setTimeout(() => {
      setFreshListIds((prev) => {
        const next = new Set(prev);
        for (const id of visible) next.delete(id);
        return next;
      });
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const item of items) {
          if (visible.includes(item.list_id)) next.delete(item.id);
        }
        return next;
      });
    }, FRESH_HOLD_MS);

    return () => clearTimeout(timer);
  }, [activeGroup, freshListIds, lists, items]);

  const groups = useMemo(() => groupNames(lists), [lists]);
  const visibleLists = useMemo(
    () => listsInGroup(lists, activeGroup),
    [lists, activeGroup]
  );
  const moveTargets = useMemo(() => lists.filter((l) => !l.is_archive), [lists]);

  const memberEmails = useMemo(
    () => (userId && userEmail ? { [userId]: userEmail } : {}),
    [userId, userEmail]
  );

  const freshGroupNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of lists) {
      if (freshListIds.has(list.id)) names.add(list.group_name);
    }
    return names;
  }, [lists, freshListIds]);

  const listById = useCallback(
    (id: string) => lists.find((l) => l.id === id) ?? null,
    [lists]
  );

  // ---------------------------------------------------------------- dictation

  function startRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition isn't supported in this browser.");
      shouldRecordRef.current = false;
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-AU";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      const { triggered, cleaned } = extractSubmitTrigger(transcript);
      const next = dictationRef.current
        ? cleaned
          ? `${dictationRef.current} ${cleaned}`
          : dictationRef.current
        : cleaned;

      dictationRef.current = next;
      setDictation(next);

      if (triggered) {
        shouldRecordRef.current = false;
        recognitionRef.current?.stop();
        void captureRef.current(next);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldRecordRef.current = false;
        setError("Microphone access was denied.");
      }
    };

    recognition.onend = () => {
      if (shouldRecordRef.current) {
        // Safari and iOS end recognition after a short pause even with
        // continuous set, so restart until the user stops it themselves.
        startRecognition();
      } else {
        setIsRecording(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }

  function toggleDictation() {
    if (isRecording) {
      shouldRecordRef.current = false;
      recognitionRef.current?.stop();
      return;
    }
    shouldRecordRef.current = true;
    startRecognition();
  }

  // ------------------------------------------------------------------ capture

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setIsReading(false);
    utterance.onerror = () => setIsReading(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsReading(true);
  }

  async function handleCapture(textOverride?: string) {
    const text = (textOverride ?? dictation).trim();
    if (!text) return;

    setIsThinking(true);
    setError(null);
    setInfoMessage(null);
    setReceipt(null);
    setAnswer(null);

    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, activeGroup: activeGroupRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read that");

      if (data.intent === "ask") {
        setAnswer(data.answer);
        speak(data.answer);
      } else if (data.intent === "add") {
        await applyAdd(data.items);
      } else if (data.intent === "update") {
        await applyUpdate(data.updates);
      } else if (data.intent === "do") {
        await applyAction(data.action);
      }

      setDictation("");
      dictationRef.current = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsThinking(false);
    }
  }

  async function applyAdd(newItems: NewItem[]) {
    if (!userId) throw new Error("Not signed in");

    const { data: inserted, error: insertError } = await supabase
      .from("items")
      .insert(newItems.map((item) => ({ ...item, created_by: userId })))
      .select();

    if (insertError) throw insertError;
    const rows = inserted ?? [];
    if (rows.length === 0) return;

    setItems((prev) => [...prev, ...rows]);
    setFreshIds((prev) => new Set([...prev, ...rows.map((r) => r.id)]));
    setFreshListIds((prev) => new Set([...prev, ...rows.map((r) => r.list_id)]));

    // The receipt is what makes auto-routing safe: it says where everything
    // went, jumps you there, and puts it all back in one tap.
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1);

    const jumps = [...counts.entries()].map(([listId, n]) => {
      const list = listById(listId);
      return {
        group: list?.group_name ?? "",
        label: `${n} → ${list?.name ?? "a list"}`,
      };
    });

    setReceipt({
      message: rows.length === 1 ? "Added" : `Added ${rows.length}`,
      jumps,
      undo: async () => {
        const ids = rows.map((r) => r.id);
        const { error: deleteError } = await supabase.from("items").delete().in("id", ids);
        if (deleteError) {
          setError(deleteError.message);
          return;
        }
        setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
        setReceipt(null);
      },
    });
  }

  async function applyUpdate(updates: ItemUpdate[]) {
    const before = new Map<string, Item>();
    const changedNames: string[] = [];

    for (const update of updates) {
      const existing = items.find((i) => i.id === update.item_id);
      if (!existing) continue;
      before.set(existing.id, existing);
      changedNames.push(existing.text);

      // Only fields Claude actually filled in are touched; the rest stay put.
      const patch: Partial<Item> = {};
      if (update.text) patch.text = update.text;
      if (update.qty) patch.qty = update.qty;
      if (update.service) patch.service = update.service;
      if (update.progress) patch.progress = update.progress;
      if (update.profile) patch.profile = update.profile;
      if (update.done !== null) {
        patch.done = update.done;
        patch.done_at = update.done ? new Date().toISOString() : null;
        patch.done_by = update.done ? userId : null;
      }

      const { error: updateError } = await supabase
        .from("items")
        .update(patch)
        .eq("id", existing.id);

      if (updateError) throw updateError;

      setItems((prev) =>
        prev.map((i) => (i.id === existing.id ? { ...i, ...patch } : i))
      );
      setFreshIds((prev) => new Set(prev).add(existing.id));
      setFreshListIds((prev) => new Set(prev).add(existing.list_id));
    }

    if (before.size === 0) {
      setError("Could not tell which item that was about.");
      return;
    }

    const first = [...before.values()][0];
    const list = listById(first.list_id);

    setReceipt({
      message: `Updated ${changedNames.join(", ")}`,
      jumps: list ? [{ group: list.group_name, label: `Go to ${list.name}` }] : [],
      undo: async () => {
        for (const original of before.values()) {
          await supabase
            .from("items")
            .update({
              text: original.text,
              qty: original.qty,
              service: original.service,
              progress: original.progress,
              profile: original.profile,
              done: original.done,
              done_at: original.done_at,
              done_by: original.done_by,
            })
            .eq("id", original.id);
        }
        setItems((prev) =>
          prev.map((i) => (before.has(i.id) ? before.get(i.id)! : i))
        );
        setReceipt(null);
      },
    });
  }

  async function applyAction(action: {
    type: "read_aloud" | "email" | "none";
    list_ids: string[];
    needs_confirmation: boolean;
  }) {
    const targets =
      action.list_ids.length > 0
        ? (action.list_ids.map(listById).filter(Boolean) as List[])
        : visibleLists;

    if (action.type === "read_aloud") {
      readLists(targets);
      return;
    }

    if (action.type === "email") {
      if (
        action.needs_confirmation &&
        !window.confirm(`Email ${targets.map((l) => l.name).join(" and ")}?`)
      ) {
        return;
      }
      await emailLists(targets);
      return;
    }

    setInfoMessage("That one isn't wired up yet.");
  }

  // Voice submissions go through this, so they always run the current handler.
  useEffect(() => {
    captureRef.current = async (text: string) => {
      await handleCapture(text);
    };
  });

  // -------------------------------------------------------------- item actions

  function holdSettling(id: string) {
    clearTimeout(settleTimers.current.get(id));
    setSettlingIds((prev) => new Set(prev).add(id));
    settleTimers.current.set(
      id,
      setTimeout(() => {
        settleTimers.current.delete(id);
        setSettlingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, COMPLETED_HOLD_MS)
    );
  }

  function releaseSettling(id: string) {
    clearTimeout(settleTimers.current.get(id));
    settleTimers.current.delete(id);
    setSettlingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function toggleDone(item: Item) {
    const done = !item.done;
    const patch = {
      done,
      done_at: done ? new Date().toISOString() : null,
      done_by: done ? userId : null,
    };

    // Flip locally first so the tick responds on the tap. The round trip runs
    // behind it and only surfaces if it fails.
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    if (done) holdSettling(item.id);
    else releaseSettling(item.id);

    const { error: updateError } = await supabase
      .from("items")
      .update(patch)
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      releaseSettling(item.id);
    }
  }

  async function editItem(item: Item, text: string) {
    const { error: updateError } = await supabase
      .from("items")
      .update({ text })
      .eq("id", item.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, text } : i)));
  }

  async function deleteItem(item: Item) {
    if (!window.confirm(`Delete "${item.text}"?`)) return;
    const { error: deleteError } = await supabase.from("items").delete().eq("id", item.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  async function moveItem(item: Item, listId: string) {
    const { error: updateError } = await supabase
      .from("items")
      .update({ list_id: listId })
      .eq("id", item.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, list_id: listId } : i)));
    const target = listById(listId);
    if (target) setInfoMessage(`Moved to ${target.name}.`);
  }

  // ----------------------------------------------------------- read and email

  function readLists(targets: List[]) {
    if (!("speechSynthesis" in window)) {
      setError("Reading aloud isn't supported in this browser.");
      return;
    }

    if (isReading) {
      window.speechSynthesis.cancel();
      setIsReading(false);
      return;
    }

    const parts: string[] = [];
    for (const list of targets) {
      const open = items.filter(
        (i) => i.list_id === list.id && !i.done && !isSnoozed(i)
      );
      if (open.length === 0) continue;
      parts.push(`${list.name}: ${open.map((i) => i.text).join(". ")}.`);
    }

    speak(parts.length === 0 ? "Nothing open on that list." : parts.join(" "));
  }

  async function emailLists(targets: List[]) {
    setIsEmailing(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await fetch("/api/email-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listIds: targets.map((l) => l.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send email");
      setInfoMessage("Sent to your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsEmailing(false);
    }
  }

  // ------------------------------------------------------------------- admin

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // ------------------------------------------------------------------ render

  function renderList(list: List, withHeading: boolean) {
    const mine = items.filter((i) => i.list_id === list.id);
    const open = mine.filter(
      (i) => (!i.done || settlingIds.has(i.id)) && !isSnoozed(i)
    );
    const doneItems = mine.filter((i) => i.done && !settlingIds.has(i.id));
    const snoozed = mine.filter((i) => !i.done && isSnoozed(i));
    const wantDone = showDone[list.id] ?? list.show_done;
    const pool = list.is_archive ? mine : open;

    return (
      <div key={list.id} className="space-y-1.5">
        {withHeading && (
          <div className="flex items-baseline gap-2 pt-2">
            <h2 className="text-base font-semibold text-slate-100">{list.name}</h2>
            <span className="text-xs text-slate-500">
              {list.is_archive ? `${mine.length} titles` : `${open.length} open`}
            </span>
          </div>
        )}

        {pool.length === 0 ? (
          <p className="text-sm text-slate-400">
            {list.is_archive ? "Nothing here yet." : "All clear."}
          </p>
        ) : (
          groupItems(list, pool, household).map((group) => (
            <div key={group.heading ?? "all"} className="space-y-1.5">
              {group.heading && (
                <p className="pt-2 text-xs uppercase tracking-wider text-slate-500">
                  {group.heading}
                </p>
              )}
              {group.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  list={list}
                  moveTargets={moveTargets.filter((l) => l.id !== list.id)}
                  isSettling={settlingIds.has(item.id)}
                  isFresh={freshIds.has(item.id)}
                  addedByInitials={initialsFor(item.created_by, members, memberEmails)}
                  doneByInitials={initialsFor(item.done_by, members, memberEmails)}
                  onToggleDone={toggleDone}
                  onEdit={editItem}
                  onDelete={deleteItem}
                  onMove={moveItem}
                />
              ))}
            </div>
          ))
        )}

        {snoozed.length > 0 && (
          <p className="text-xs text-slate-500">{snoozed.length} snoozed until tomorrow</p>
        )}

        {!list.is_archive && doneItems.length > 0 && (
          <>
            <button
              onClick={() =>
                setShowDone((prev) => ({ ...prev, [list.id]: !wantDone }))
              }
              className="mt-1 flex items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-1.5 text-xs text-orange-300"
            >
              <ListChecks className="h-3.5 w-3.5" />
              {wantDone ? "Hide" : "Show"} {doneItems.length}{" "}
              {list.auto_clear ? "bought" : "done"}
            </button>
            {wantDone && (
              <div className="space-y-1.5 pt-1">
                {doneItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    list={list}
                    moveTargets={moveTargets.filter((l) => l.id !== list.id)}
                    isSettling={false}
                    isFresh={false}
                    addedByInitials={initialsFor(item.created_by, members, memberEmails)}
                    doneByInitials={initialsFor(item.done_by, members, memberEmails)}
                    onToggleDone={toggleDone}
                    onEdit={editItem}
                    onDelete={deleteItem}
                    onMove={moveItem}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Lists</h1>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white shadow-md"
        >
          {userEmail ? initialsFromEmail(userEmail) : "?"}
        </button>
      </div>

      {isOwner && (
        <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4 backdrop-blur">
          <button
            onClick={() => setShowAdminPanel((v) => !v)}
            className="flex items-center gap-2 text-sm text-slate-300"
          >
            <Shield className="h-4 w-4" />
            {showAdminPanel ? "Hide" : "Manage"} access ({allowedEmails.length})
          </button>

          {showAdminPanel && (
            <div className="space-y-2">
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
        </div>
      )}

      {groups.length > 0 && (
        <PillRail
          groups={groups}
          lists={lists}
          items={items}
          activeGroup={activeGroup}
          freshGroups={freshGroupNames}
          onSelect={setActiveGroup}
        />
      )}

      <div className="space-y-4">
        <div className="rounded-2xl border border-blue-500/20 bg-slate-900/70 p-4 shadow-lg shadow-blue-950/30 backdrop-blur">
          <textarea
            value={dictation}
            onChange={(e) => {
              dictationRef.current = e.target.value;
              setDictation(e.target.value);
            }}
            placeholder="Say anything — for any list, or ask a question..."
            rows={3}
            className="w-full resize-none bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            {isRecording && (
              <div className="flex h-5 items-end gap-0.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="waveform-bar w-1 rounded-full bg-blue-400"
                    style={{ height: "100%", animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </div>
            )}
            <button
              onClick={toggleDictation}
              aria-label={isRecording ? "Stop dictation" : "Start dictation"}
              className={`ml-auto flex h-10 w-10 items-center justify-center rounded-full transition ${
                isRecording
                  ? "bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          onClick={() => handleCapture()}
          disabled={isThinking || !dictation.trim()}
          className="w-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-[0_0_25px_rgba(37,99,235,0.35)] transition hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:shadow-none"
        >
          {isThinking ? "Working it out..." : "Go"}
        </button>
      </div>

      {receipt && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-900/25 px-3 py-2 text-sm">
          <b className="font-semibold text-emerald-200">{receipt.message}</b>
          {receipt.jumps.map((jump) => (
            <button
              key={jump.label}
              onClick={() => setActiveGroup(jump.group)}
              className="rounded-full border border-emerald-500/45 px-2.5 py-0.5 text-xs text-emerald-300 hover:bg-emerald-500/15"
            >
              {jump.label}
            </button>
          ))}
          <button
            onClick={() => void receipt.undo()}
            className="ml-auto text-xs text-slate-300 underline"
          >
            Undo
          </button>
        </div>
      )}

      {answer && (
        <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 px-3 py-2 text-sm text-blue-100">
          {answer}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {infoMessage && <p className="text-sm text-green-400">{infoMessage}</p>}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => readLists(visibleLists)}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm backdrop-blur disabled:opacity-40 ${
              isReading
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-slate-700 bg-slate-900/60 text-slate-200"
            }`}
          >
            {isReading ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {isReading ? "Stop reading" : "Read aloud"}
          </button>
          <button
            onClick={() => void emailLists(visibleLists)}
            disabled={isEmailing}
            className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm text-slate-200 backdrop-blur disabled:opacity-40"
          >
            <Mail className="h-4 w-4" />
            {isEmailing ? "Sending..." : "Email me"}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : lists.length === 0 ? (
          <p className="text-sm text-slate-400">
            No lists yet. Run the household migration in Supabase, then reload.
          </p>
        ) : (
          <div className="space-y-3">
            {visibleLists.map((list) =>
              renderList(list, visibleLists.length > 1)
            )}
          </div>
        )}
      </div>
    </main>
  );
}
