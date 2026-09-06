"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ListChecks,
  Mail,
  Mic,
  Eraser,
  Repeat,
  Search,
  Settings,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  Household,
  Item,
  ItemUpdate,
  List,
  Member,
  NewItem,
} from "@/lib/types";
import {
  bumpEpisode,
  groupItems,
  groupNames,
  initialsFor,
  initialsFromEmail,
  isSnoozed,
  listsInGroup,
  watchVerdict,
} from "@/lib/display";
import { matchLocalCommand } from "@/lib/commands";
import PillRail from "@/components/PillRail";
import ItemRow from "@/components/ItemRow";

// How long a ticked item stays in the open list, crossed out, before it moves
// to the done section. Long enough to see it happen.
const COMPLETED_HOLD_MS = 1000;

// How long newly added items keep their green NEW state after you open the
// list they landed in.
const FRESH_HOLD_MS = 2600;

const LAST_GROUP_KEY = "list-app:last-group";

// What you say to stop dictating and send it. Longer phrases sit first so
// "create my list" doesn't leave a stray "my" behind after a looser match.
const SUBMIT_TRIGGERS = [
  "create the list",
  "create my list",
  "create list",
  "make the list",
  "make my list",
  "make list",
  "that's it",
  "send it",
  "go ahead",
  "go",
  "done",
];

/**
 * Finds a spoken submit phrase and strips it off.
 *
 * Only matched at the very end of what has been said so far. Matching anywhere
 * would fire halfway through a sentence: "make a list of things for the shops"
 * would submit on "make a list", and "go to the hardware store" on "go".
 */
function extractSubmitTrigger(text: string) {
  // Speech recognition adds trailing punctuation and curly apostrophes.
  const normalised = text.replace(/\u2019/g, "'").replace(/[.!?,;\s]+$/, "");
  const lower = normalised.toLowerCase();

  for (const phrase of SUBMIT_TRIGGERS) {
    if (!lower.endsWith(phrase)) continue;

    const start = normalised.length - phrase.length;
    // Must be a whole word, so "mango" doesn't end the list on "go".
    if (start > 0 && /[a-z0-9]/i.test(normalised[start - 1])) continue;

    const cleaned = normalised.slice(0, start).replace(/[.,;!?\s]+$/, "").trim();
    return { triggered: true, cleaned };
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

  const [movingItem, setMovingItem] = useState<Item | null>(null);
  const [servicingItem, setServicingItem] = useState<Item | null>(null);
  const [watchQuery, setWatchQuery] = useState("");
  const [picks, setPicks] = useState<
    { item_id: string; text: string; service: string | null; reason: string }[] | null
  >(null);
  const [isPicking, setIsPicking] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

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
  const moveTargets = useMemo(
    () => [...lists].sort((a, b) => a.position - b.position),
    [lists]
  );
  const isWatchGroup = useMemo(
    () => visibleLists.some((l) => l.kind === "watch"),
    [visibleLists]
  );
  const verdict = useMemo(
    () => (isWatchGroup ? watchVerdict(watchQuery, items, lists) : null),
    [isWatchGroup, watchQuery, items, lists]
  );

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

  /** Switching pills resets the state that only makes sense on one screen. */
  function selectGroup(group: string) {
    setActiveGroup(group);
    setWatchQuery("");
    setPicks(null);
    setShowArchive(false);
  }

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

      const combined = dictationRef.current
        ? `${dictationRef.current} ${transcript}`
        : transcript;
      const { triggered, cleaned } = extractSubmitTrigger(combined.trim());

      dictationRef.current = cleaned;
      setDictation(cleaned);

      if (triggered && cleaned) {
        shouldRecordRef.current = false;
        recognitionRef.current?.stop();
        void captureRef.current(cleaned);
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

    // The handful of commands worth recognising here run without touching the
    // network at all, which is what makes ticking things off work in a
    // supermarket with one bar of signal — and instantly everywhere else.
    const local = matchLocalCommand(text, { items, lists, groups });
    if (local) {
      setError(null);
      setReceipt(null);
      setAnswer(null);
      setDictation("");
      dictationRef.current = "";

      if (local.type === "tick") {
        setInfoMessage(`Ticked off ${local.item.text}.`);
        await toggleDone(local.item);
      } else if (local.type === "switch") {
        setInfoMessage(null);
        selectGroup(local.group);
      } else {
        const targets = local.group
          ? listsInGroup(lists, local.group)
          : visibleLists;
        setInfoMessage(null);
        readLists(targets);
      }
      return;
    }

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
    type: "read_aloud" | "email" | "clear_bought" | "none";
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

    if (action.type === "clear_bought") {
      // Always asks, however confident the request sounded. Clearing a shop is
      // a reasonable thing to say out loud and a terrible thing to get wrong.
      for (const list of targets.filter((l) => l.auto_clear)) {
        await clearBought(list);
      }
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
    const list = listById(item.list_id);

    // A list can say where a ticked item goes: finishing a show files it under
    // Watched. Un-ticking walks it back to whichever list sent it there.
    const sentBy = lists.find((l) => l.done_to === item.list_id);
    const destination = done ? (list?.done_to ?? null) : (sentBy?.id ?? null);

    const patch = {
      done,
      done_at: done ? new Date().toISOString() : null,
      done_by: done ? userId : null,
      ...(destination ? { list_id: destination } : {}),
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
      return;
    }

    // A ticked show leaves the screen entirely when it files itself under
    // Watched, so say where it went rather than letting it just vanish.
    if (destination) {
      const target = listById(destination);
      if (target) setInfoMessage(`Filed under ${target.name}.`);
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
    const target = listById(listId);
    if (!target) return;

    // An archive means finished, so arriving there ticks an item off and
    // leaving it un-ticks. Otherwise a show dragged out of Watched sits in
    // its new list looking like something still to do.
    const source = listById(item.list_id);
    const patch: Partial<Item> = { list_id: listId };
    if (target.is_archive && !item.done) {
      patch.done = true;
      patch.done_at = new Date().toISOString();
      patch.done_by = userId;
    } else if (source?.is_archive && !target.is_archive && item.done) {
      patch.done = false;
      patch.done_at = null;
      patch.done_by = null;
    }

    const { error: updateError } = await supabase
      .from("items")
      .update(patch)
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    setInfoMessage(`Moved to ${target.name}.`);
  }

  async function promoteItem(item: Item) {
    const list = listById(item.list_id);
    if (!list?.promote_to) return;

    const patch = {
      list_id: list.promote_to,
      // Something being started needs a place to record where you are up to.
      progress: item.progress ?? "S1 E1",
    };

    const { error: updateError } = await supabase
      .from("items")
      .update(patch)
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    const target = listById(list.promote_to);
    if (target) setInfoMessage(`Moved to ${target.name}.`);
  }

  async function bumpItemEpisode(item: Item) {
    const progress = bumpEpisode(item.progress);
    if (progress === item.progress) return;

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, progress } : i)));

    const { error: updateError } = await supabase
      .from("items")
      .update({ progress })
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  }

  async function setItemService(item: Item, service: string) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, service } : i)));

    const { error: updateError } = await supabase
      .from("items")
      .update({ service })
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  }

  async function pickSomething() {
    setIsPicking(true);
    setError(null);
    setPicks(null);

    try {
      const res = await fetch("/api/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listIds: visibleLists.filter((l) => !l.is_archive).map((l) => l.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not pick anything");
      setPicks(data.picks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsPicking(false);
    }
  }

  /**
   * A shopping list is a session, not a record. Without this, every week's shop
   * stacks up until you are scrolling past hundreds of ticked items to find
   * this week's. It archives rather than deletes, because that history is what
   * "the usuals" below is learned from.
   */
  async function clearBought(list: List) {
    const bought = items.filter((i) => i.list_id === list.id && i.done);
    if (bought.length === 0) return;
    if (!window.confirm(`Clear ${bought.length} bought from ${list.name}?`)) return;

    const ids = bought.map((i) => i.id);
    const { error: updateError } = await supabase
      .from("items")
      .update({ archived_at: new Date().toISOString() })
      .in("id", ids);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
    setInfoMessage(`Cleared ${bought.length}. Ready for next week.`);
  }

  /**
   * What you buy most weeks, worked out from what you have cleared before
   * rather than a list you keep by hand. Entirely local: no API call, no cost.
   */
  async function addUsuals(list: List) {
    setError(null);
    setInfoMessage(null);

    const { data, error: historyError } = await supabase
      .from("items")
      .select("text, qty, aisle")
      .eq("list_id", list.id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(500);

    if (historyError) {
      setError(historyError.message);
      return;
    }

    const history = data ?? [];
    const alreadyHere = new Set(
      items
        .filter((i) => i.list_id === list.id && !i.done)
        .map((i) => i.text.trim().toLowerCase())
    );

    // Counted case-insensitively, keeping the spelling used most recently.
    const seen = new Map<
      string,
      { text: string; qty: string | null; aisle: string | null; count: number }
    >();
    for (const row of history) {
      const key = row.text.trim().toLowerCase();
      if (!key || alreadyHere.has(key)) continue;
      const existing = seen.get(key);
      if (existing) existing.count += 1;
      else seen.set(key, { text: row.text, qty: row.qty, aisle: row.aisle, count: 1 });
    }

    // Twice is the threshold: bought once is a one-off, not a usual.
    const usuals = [...seen.values()]
      .filter((u) => u.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    if (usuals.length === 0) {
      setInfoMessage(
        "Not enough history yet. After a few shops this fills itself in."
      );
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("items")
      .insert(
        usuals.map((u) => ({
          list_id: list.id,
          text: u.text,
          qty: u.qty,
          aisle: u.aisle,
          created_by: userId,
        }))
      )
      .select();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const rows = inserted ?? [];
    setItems((prev) => [...prev, ...rows]);
    setFreshIds((prev) => new Set([...prev, ...rows.map((r) => r.id)]));
    setFreshListIds((prev) => new Set(prev).add(list.id));
    setInfoMessage(`Added ${rows.length} you usually buy.`);
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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // ------------------------------------------------------------------ render

  function renderList(list: List, withHeading: boolean) {
    const mine = items.filter((i) => i.list_id === list.id);

    if (list.is_archive && !showArchive) {
      return (
        <div key={list.id} className="space-y-1.5">
          <div className="flex items-baseline gap-2 pt-2">
            <h2 className="text-base font-semibold text-slate-100">{list.name}</h2>
            <span className="text-xs text-slate-500">{mine.length} titles</span>
          </div>
          <button
            onClick={() => setShowArchive(true)}
            className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300"
          >
            Show everything we have finished
          </button>
        </div>
      );
    }
    const open = mine.filter(
      (i) => (!i.done || settlingIds.has(i.id)) && !isSnoozed(i)
    );
    const doneItems = mine.filter((i) => i.done && !settlingIds.has(i.id));
    const snoozed = mine.filter((i) => !i.done && isSnoozed(i));
    const wantDone = showDone[list.id] ?? list.show_done;
    const query = watchQuery.trim().toLowerCase();
    const matching = (rows: Item[]) =>
      query ? rows.filter((i) => i.text.toLowerCase().includes(query)) : rows;
    const pool = matching(list.is_archive ? mine : open);

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
                  isSettling={settlingIds.has(item.id)}
                  isFresh={freshIds.has(item.id)}
                  addedByInitials={initialsFor(item.created_by, members, memberEmails)}
                  doneByInitials={initialsFor(item.done_by, members, memberEmails)}
                  onToggleDone={toggleDone}
                  onEdit={editItem}
                  onDelete={deleteItem}
                  onRequestMove={setMovingItem}
                  onRequestService={setServicingItem}
                  onPromote={promoteItem}
                  onBumpEpisode={bumpItemEpisode}
                />
              ))}
            </div>
          ))
        )}

        {snoozed.length > 0 && (
          <p className="text-xs text-slate-500">{snoozed.length} snoozed until tomorrow</p>
        )}

        {list.auto_clear && (
          <button
            onClick={() => void addUsuals(list)}
            className="mt-1 flex items-center gap-2 rounded-full border border-blue-500/45 bg-blue-500/15 px-3 py-1.5 text-xs text-blue-100"
          >
            <Repeat className="h-3.5 w-3.5" />
            Add the usuals
          </button>
        )}

        {!list.is_archive && doneItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
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
            {list.auto_clear && (
              <button
                onClick={() => void clearBought(list)}
                className="mt-1 flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300"
              >
                <Eraser className="h-3.5 w-3.5" />
                Clear {doneItems.length} bought
              </button>
            )}
          </div>
        )}

        {!list.is_archive && doneItems.length > 0 && wantDone && (
          <div className="space-y-1.5 pt-1">
            {doneItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                list={list}
                isSettling={false}
                isFresh={false}
                addedByInitials={initialsFor(item.created_by, members, memberEmails)}
                doneByInitials={initialsFor(item.done_by, members, memberEmails)}
                onToggleDone={toggleDone}
                onEdit={editItem}
                onDelete={deleteItem}
                onRequestMove={setMovingItem}
                onRequestService={setServicingItem}
                onPromote={promoteItem}
                onBumpEpisode={bumpItemEpisode}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Sorted</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white shadow-md"
          >
            {userEmail ? initialsFromEmail(userEmail) : "?"}
          </button>
        </div>
      </div>

      {groups.length > 0 && (
        <PillRail
          groups={groups}
          lists={lists}
          items={items}
          activeGroup={activeGroup}
          freshGroups={freshGroupNames}
          onSelect={selectGroup}
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
            <span className="text-xs text-slate-500">
              {isRecording ? 'Say "go" when you\'re finished' : ""}
            </span>
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
              onClick={() => selectGroup(jump.group)}
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

        {isWatchGroup && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={watchQuery}
                onChange={(e) => setWatchQuery(e.target.value)}
                placeholder="Have we watched this?"
                aria-label="Search everything you have watched"
                className="w-full rounded-xl border border-slate-700 bg-slate-900/60 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500"
              />
            </div>

            {verdict && (
              <p
                className={`rounded-xl border px-3 py-2 text-sm ${
                  verdict.found
                    ? "border-emerald-500/40 bg-emerald-900/25 text-emerald-100"
                    : "border-slate-700 bg-slate-900/60 text-slate-300"
                }`}
              >
                {verdict.text}
              </p>
            )}

            <button
              onClick={() => void pickSomething()}
              disabled={isPicking}
              className="flex items-center gap-2 rounded-full border border-blue-500/50 bg-blue-500/15 px-4 py-2 text-sm text-blue-100 disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              {isPicking ? "Having a think..." : "Pick something"}
            </button>

            {picks?.map((pick) => (
              <div
                key={pick.item_id}
                className="rounded-xl border border-blue-500/35 bg-blue-950/30 px-3 py-2"
              >
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
                  {pick.text}
                  {pick.service && (
                    <span className="rounded border border-slate-600 bg-slate-500/10 px-1.5 text-[10px] font-normal text-slate-300">
                      {pick.service}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-slate-300">{pick.reason}</p>
                <button
                  onClick={() => {
                    const item = items.find((i) => i.id === pick.item_id);
                    if (item) void promoteItem(item);
                    setPicks(null);
                  }}
                  className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Start watching
                </button>
              </div>
            ))}
          </div>
        )}

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

      {/*
        These sit at page level rather than inside the row. Each row carries a
        backdrop blur, which creates its own stacking context, so a menu drawn
        inside one is trapped there and the rows below paint straight over it.
        A sheet is also the right shape on a phone, where a dropdown next to the
        last row would fall off the bottom of the screen.
      */}
      {movingItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3"
          onClick={() => setMovingItem(null)}
        >
          <div
            role="dialog"
            aria-label="Move to another list"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-3 shadow-2xl"
          >
            <p className="px-1 pb-2 text-xs uppercase tracking-wider text-slate-500">
              Move &ldquo;{movingItem.text}&rdquo; to
            </p>
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {moveTargets
                .filter((l) => l.id !== movingItem.list_id)
                .map((target) => (
                  <button
                    key={target.id}
                    onClick={() => {
                      void moveItem(movingItem, target.id);
                      setMovingItem(null);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-blue-500/20 hover:text-blue-100"
                  >
                    {target.name}
                    <span className="text-xs text-slate-500">
                      {target.group_name}
                      {target.is_archive ? " · archive" : ""}
                    </span>
                  </button>
                ))}
            </div>
            <button
              onClick={() => setMovingItem(null)}
              className="mt-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {servicingItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3"
          onClick={() => setServicingItem(null)}
        >
          <div
            role="dialog"
            aria-label="Set the streaming service"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-3 shadow-2xl"
          >
            <p className="px-1 pb-2 text-xs uppercase tracking-wider text-slate-500">
              Where can we watch &ldquo;{servicingItem.text}&rdquo;?
            </p>
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {(household?.services ?? []).map((service) => (
                <button
                  key={service}
                  onClick={() => {
                    void setItemService(servicingItem, service);
                    setServicingItem(null);
                  }}
                  className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-blue-500/20 hover:text-blue-100"
                >
                  {service}
                </button>
              ))}
            </div>
            <button
              onClick={() => setServicingItem(null)}
              className="mt-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
