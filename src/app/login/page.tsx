"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic-link";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email for a login link.");
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else if (isSignUp) {
      setMessage("Check your email to confirm your account, then sign in.");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Task List</h1>
          <p className="text-sm text-gray-500">
            {mode === "magic-link"
              ? "Sign in with a magic link."
              : isSignUp
              ? "Create an account."
              : "Sign in with your password."}
          </p>
        </div>

        <form
          onSubmit={mode === "magic-link" ? handleMagicLink : handlePassword}
          className="space-y-3"
        >
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
          />

          {mode === "password" && (
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
            />
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : mode === "magic-link"
              ? "Send magic link"
              : isSignUp
              ? "Sign up"
              : "Sign in"}
          </button>
        </form>

        {message && <p className="text-sm text-green-600">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between text-sm text-gray-500">
          <button
            type="button"
            onClick={() =>
              setMode(mode === "magic-link" ? "password" : "magic-link")
            }
            className="underline"
          >
            {mode === "magic-link"
              ? "Use a password instead"
              : "Use a magic link instead"}
          </button>

          {mode === "password" && (
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="underline"
            >
              {isSignUp ? "Sign in instead" : "Sign up instead"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
