"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "code";
type CodeStep = "request" | "verify";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("code");
  const [codeStep, setCodeStep] = useState<CodeStep>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setCodeStep("verify");
      setMessage(`Sent a login code to ${email}.`);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.push("/");
      router.refresh();
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

  function switchMode(next: Mode) {
    setMode(next);
    setCodeStep("request");
    setCode("");
    setError(null);
    setMessage(null);
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Task List</h1>
          <p className="text-sm text-gray-500">
            {mode === "code"
              ? codeStep === "request"
                ? "Sign in with a one-time code."
                : "Enter the code we emailed you."
              : isSignUp
              ? "Create an account."
              : "Sign in with your password."}
          </p>
        </div>

        {mode === "code" ? (
          <form
            onSubmit={codeStep === "request" ? handleSendCode : handleVerifyCode}
            className="space-y-3"
          >
            <input
              type="email"
              required
              disabled={codeStep === "verify"}
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 disabled:bg-gray-50 disabled:text-gray-500"
            />

            {codeStep === "verify" && (
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="Code from your email"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-gray-500"
              />
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading
                ? "Please wait..."
                : codeStep === "request"
                ? "Send code"
                : "Verify code"}
            </button>

            {codeStep === "verify" && (
              <button
                type="button"
                onClick={() => {
                  setCodeStep("request");
                  setCode("");
                  setMessage(null);
                }}
                className="w-full text-center text-sm text-gray-500 underline"
              >
                Use a different email
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={handlePassword} className="space-y-3">
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
            />

            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Please wait..." : isSignUp ? "Sign up" : "Sign in"}
            </button>
          </form>
        )}

        {message && <p className="text-sm text-green-600">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between text-sm text-gray-500">
          <button
            type="button"
            onClick={() => switchMode(mode === "code" ? "password" : "code")}
            className="underline"
          >
            {mode === "code" ? "Use a password instead" : "Use a code instead"}
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
