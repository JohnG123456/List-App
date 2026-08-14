"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ListChecks,
  Mail,
  Mic,
  Shield,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Task = {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
};

type AllowedEmail = {
  id: string;
  email: string;
};

// Must match the email hardcoded into the RLS policies in
// supabase/migrations/0002_allowed_emails.sql — update both if it changes.
const ADMIN_EMAIL = "john@greenborough.com.au";

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  const day = date.getDate();
  const month = date.toLocaleString(undefined, { month: "short" });
  const hours24 = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours24 >= 12 ? "pm" : "am";
  const hours = hours24 % 12 || 12;
  return `${day} ${month} at ${hours}:${minutes} ${ampm}`;
}

function getInitials(email: string) {
  const local = email.split("@")[0];
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  const initials =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return initials.toUpperCase();
}

const CREATE_LIST_TRIGGERS = [
  "create the list",
  "create my list",
  "create list",
  "make the list",
  "make my list",
  "make list",
];

// Looks for a spoken "create list" style command and strips it out. Longer
// phrases are checked first so e.g. "create my list" doesn't leave a
// stray "my" behind after a looser match.
function extractCreateListTrigger(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of CREATE_LIST_TRIGGERS) {
    const index = lower.indexOf(phrase);
    if (index !== -1) {
      const cleaned = (
        text.slice(0, index) + text.slice(index + phrase.length)
      ).trim();
      return { triggered: true, cleaned };
    }
  }
  return { triggered: false, cleaned: text };
}

export default function Home() {
  const router = useRouter();
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [dictation, setDictation] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isEmailingList, setIsEmailingList] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [allowedEmails, setAllowedEmails] = useState<AllowedEmail[]>([]);
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRecordRef = useRef(false);
  const dictationRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const [tasksResult, userResult] = await Promise.all([
        supabase.from("tasks").select("*").order("created_at", { ascending: true }),
        supabase.auth.getUser(),
      ]);

      if (cancelled) return;

      if (tasksResult.error) setError(tasksResult.error.message);
      else setTasks(tasksResult.data ?? []);

      const email = userResult.data.user?.email ?? null;
      setUserEmail(email);
      setLoadingTasks(false);

      if (email === ADMIN_EMAIL) {
        const { data, error } = await supabase
          .from("allowed_emails")
          .select("id, email")
          .order("created_at", { ascending: true });

        if (!cancelled) {
          if (error) setError(error.message);
          else setAllowedEmails(data ?? []);
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

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
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      const { triggered, cleaned } = extractCreateListTrigger(transcript);
      const next = dictationRef.current
        ? cleaned
          ? `${dictationRef.current} ${cleaned}`
          : dictationRef.current
        : cleaned;

      dictationRef.current = next;
      setDictation(next);

      if (triggered) {
        // Saying "create list" is treated as an explicit stop-and-submit —
        // end dictation for real (no auto-restart) and submit right away
        // rather than waiting for the user to tap the buttons.
        shouldRecordRef.current = false;
        recognitionRef.current?.stop();
        handleTurnIntoList(next);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Permission/hardware failures are unrecoverable — stop for real.
      // Other errors (e.g. "no-speech") are followed by onend, which
      // decides whether to restart, so leave those alone here.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldRecordRef.current = false;
        setError("Microphone access was denied.");
      }
    };

    recognition.onend = () => {
      if (shouldRecordRef.current) {
        // Safari/iOS ends recognition sessions after a short pause even
        // with continuous set, so restart automatically to keep dictation
        // going until the user explicitly stops it.
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

  async function handleTurnIntoList(textOverride?: string) {
    const text = (textOverride ?? dictation).trim();
    if (!text) return;
    setIsParsing(true);
    setError(null);

    try {
      const res = await fetch("/api/parse-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse tasks");

      const tasksToInsert: string[] = data.tasks ?? [];
      if (tasksToInsert.length === 0) {
        setError("No tasks were found in that text.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: inserted, error: insertError } = await supabase
        .from("tasks")
        .insert(tasksToInsert.map((text) => ({ text, user_id: user.id })))
        .select();

      if (insertError) throw insertError;

      setTasks((prev) => [...prev, ...(inserted ?? [])]);
      setDictation("");
      dictationRef.current = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsParsing(false);
    }
  }

  async function toggleDone(task: Task) {
    const { error } = await supabase
      .from("tasks")
      .update({ done: !task.done })
      .eq("id", task.id);

    if (error) {
      setError(error.message);
      return;
    }

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))
    );
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete "${task.text}"?`)) return;

    const { error } = await supabase.from("tasks").delete().eq("id", task.id);

    if (error) {
      setError(error.message);
      return;
    }

    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function addAllowedEmail(e: React.FormEvent) {
    e.preventDefault();
    const email = newAllowedEmail.trim().toLowerCase();
    if (!email) return;

    const { data, error } = await supabase
      .from("allowed_emails")
      .insert({ email })
      .select("id, email")
      .single();

    if (error) {
      setError(error.message);
      return;
    }

    setAllowedEmails((prev) => [...prev, data]);
    setNewAllowedEmail("");
  }

  async function removeAllowedEmail(entry: AllowedEmail) {
    if (!window.confirm(`Remove access for ${entry.email}?`)) return;

    const { error } = await supabase
      .from("allowed_emails")
      .delete()
      .eq("id", entry.id);

    if (error) {
      setError(error.message);
      return;
    }

    setAllowedEmails((prev) => prev.filter((e) => e.id !== entry.id));
  }

  function handleReadList() {
    if (!("speechSynthesis" in window)) {
      setError("Reading aloud isn't supported in this browser.");
      return;
    }

    if (isReading) {
      window.speechSynthesis.cancel();
      setIsReading(false);
      return;
    }

    const openTasks = tasks.filter((t) => !t.done);
    const text =
      openTasks.length === 0
        ? "You have no open tasks."
        : `You have ${openTasks.length} open task${
            openTasks.length === 1 ? "" : "s"
          }: ${openTasks.map((t) => t.text).join(". ")}.`;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setIsReading(false);
    utterance.onerror = () => setIsReading(false);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsReading(true);
  }

  async function handleEmailList() {
    setIsEmailingList(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await fetch("/api/email-list", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send email");
      setInfoMessage("Sent to your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsEmailingList(false);
    }
  }

  const openTasks = tasks.filter((t) => !t.done);
  const completedTasks = tasks.filter((t) => t.done);

  function renderTask(task: Task) {
    return (
      <div
        key={task.id}
        className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-3 backdrop-blur"
      >
        <button
          onClick={() => toggleDone(task)}
          aria-label={task.done ? "Mark as not done" : "Mark as done"}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
            task.done
              ? "border-blue-500 bg-blue-500"
              : "border-slate-600 hover:border-blue-500"
          }`}
        >
          {task.done && <Check className="h-4 w-4 text-white" />}
        </button>
        <div className="flex-1">
          <p
            className={`text-sm ${
              task.done ? "text-slate-500 line-through" : "text-slate-100"
            }`}
          >
            {task.text}
          </p>
          <p className="text-xs text-slate-500">
            {formatTimestamp(task.created_at)}
          </p>
        </div>
        <button
          onClick={() => deleteTask(task)}
          aria-label="Delete task"
          className="shrink-0 text-slate-500 hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Voice Task List</h1>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white shadow-md"
        >
          {userEmail ? getInitials(userEmail) : "?"}
        </button>
      </div>

      {userEmail === ADMIN_EMAIL && (
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

      <div className="space-y-4">
        <div className="rounded-2xl border border-blue-500/20 bg-slate-900/70 p-4 shadow-lg shadow-blue-950/30 backdrop-blur">
          <textarea
            value={dictation}
            onChange={(e) => {
              dictationRef.current = e.target.value;
              setDictation(e.target.value);
            }}
            placeholder="Dictate or type a list of tasks..."
            rows={4}
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
              {isRecording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <button
          onClick={() => handleTurnIntoList()}
          disabled={isParsing || !dictation.trim()}
          className="w-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-[0_0_25px_rgba(37,99,235,0.35)] transition hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:shadow-none"
        >
          {isParsing ? "Creating list..." : "Create list"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {infoMessage && <p className="text-sm text-green-400">{infoMessage}</p>}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleReadList}
            disabled={!isReading && openTasks.length === 0}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm backdrop-blur disabled:opacity-40 ${
              isReading
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-slate-700 bg-slate-900/60 text-slate-200"
            }`}
          >
            {isReading ? (
              <Square className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            {isReading ? "Stop reading" : "Read aloud"}
          </button>
          <button
            onClick={handleEmailList}
            disabled={isEmailingList || openTasks.length === 0}
            className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm text-slate-200 backdrop-blur disabled:opacity-40"
          >
            <Mail className="h-4 w-4" />
            {isEmailingList ? "Sending..." : "Email me"}
          </button>
          {completedTasks.length > 0 && (
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="ml-auto flex items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm text-orange-300"
            >
              <ListChecks className="h-4 w-4" />
              {showCompleted ? "Hide completed" : `${completedTasks.length} completed`}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {loadingTasks ? (
            <p className="text-sm text-slate-400">Loading tasks...</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-slate-400">No tasks yet.</p>
          ) : openTasks.length === 0 ? (
            <p className="text-sm text-slate-400">
              No open tasks — nice work.
            </p>
          ) : (
            openTasks.map(renderTask)
          )}
        </div>

        {showCompleted && completedTasks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase text-slate-500">
              Completed
            </p>
            {completedTasks.map(renderTask)}
          </div>
        )}
      </div>
    </main>
  );
}
