"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ListChecks, Mic, Square, Trash2, Volume2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Task = {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
};

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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRecordRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const [tasksResult, userResult] = await Promise.all([
        supabase.from("tasks").select("*").order("created_at", { ascending: true }),
        supabase.auth.getUser(),
      ]);

      if (!cancelled) {
        if (tasksResult.error) setError(tasksResult.error.message);
        else setTasks(tasksResult.data ?? []);
        setUserEmail(userResult.data.user?.email ?? null);
        setLoadingTasks(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

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
      setDictation((prev) => (prev ? `${prev} ${transcript}` : transcript));
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

  async function handleTurnIntoList() {
    if (!dictation.trim()) return;
    setIsParsing(true);
    setError(null);

    try {
      const res = await fetch("/api/parse-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: dictation }),
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

  function handleReadList() {
    if (!("speechSynthesis" in window)) {
      setError("Reading aloud isn't supported in this browser.");
      return;
    }

    const openTasks = tasks.filter((t) => !t.done);
    const text =
      openTasks.length === 0
        ? "You have no open tasks."
        : `You have ${openTasks.length} open task${
            openTasks.length === 1 ? "" : "s"
          }: ${openTasks.map((t) => t.text).join(". ")}.`;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
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

      <div className="space-y-4">
        <div className="rounded-2xl border border-blue-500/20 bg-slate-900/70 p-4 shadow-lg shadow-blue-950/30 backdrop-blur">
          <textarea
            value={dictation}
            onChange={(e) => setDictation(e.target.value)}
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
          onClick={handleTurnIntoList}
          disabled={isParsing || !dictation.trim()}
          className="w-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-[0_0_25px_rgba(37,99,235,0.35)] transition hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:shadow-none"
        >
          {isParsing ? "Creating list..." : "Create list"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={handleReadList}
            disabled={openTasks.length === 0}
            className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm text-slate-200 backdrop-blur disabled:opacity-40"
          >
            <Volume2 className="h-4 w-4" />
            Read aloud
          </button>
          {completedTasks.length > 0 && (
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm text-orange-300"
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
