"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Task = {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
};

export default function Home() {
  const router = useRouter();
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [dictation, setDictation] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRecordRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: true });

      if (!cancelled) {
        if (error) setError(error.message);
        else setTasks(data ?? []);
        setLoadingTasks(false);
      }
    }

    loadTasks();
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

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Task List</h1>
        <button
          onClick={handleSignOut}
          className="text-sm text-gray-500 underline"
        >
          Sign out
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        <textarea
          value={dictation}
          onChange={(e) => setDictation(e.target.value)}
          placeholder="Dictate or type a list of tasks..."
          rows={4}
          className="w-full resize-none rounded-md border border-gray-300 p-2 text-sm outline-none focus:border-gray-500"
        />
        <div className="flex gap-2">
          <button
            onClick={toggleDictation}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              isRecording
                ? "bg-red-600 text-white"
                : "bg-gray-100 text-gray-900"
            }`}
          >
            {isRecording ? "Stop" : "Dictate"}
          </button>
          <button
            onClick={handleTurnIntoList}
            disabled={isParsing || !dictation.trim()}
            className="flex-1 rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isParsing ? "Turning into list..." : "Turn into list"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {loadingTasks ? (
          <p className="text-sm text-gray-500">Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-gray-500">No tasks yet.</p>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-3 rounded-md border border-gray-200 p-3"
            >
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => toggleDone(task)}
                className="h-4 w-4"
              />
              <span
                className={`flex-1 text-sm ${
                  task.done ? "text-gray-400 line-through" : "text-gray-900"
                }`}
              >
                {task.text}
              </span>
              <button
                onClick={() => deleteTask(task)}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
