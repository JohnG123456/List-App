"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "code";
type CodeStep = "request" | "verify";

const inputClass =
  "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500 disabled:opacity-50";

const primaryButtonClass =
  "w-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-3 py-2.5 text-sm font-semibold text-white shadow-[0_0_25px_rgba(37,99,235,0.35)] transition hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] disabled:opacity-50 disabled:shadow-none";

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

    const { data: allowed, error: allowedError } = await supabase.rpc(
      "is_email_allowed",
      { check_email: email }
    );

    if (allowedError) {
      setLoading(false);
      setError(allowedError.message);
      return;
    }

    if (!allowed) {
      setLoading(false);
      setError("This email hasn't been given access to this app.");
      return;
    }

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

    if (isSignUp) {
      const { data: allowed, error: allowedError } = await supabase.rpc(
        "is_email_allowed",
        { check_email: email }
      );

      if (allowedError) {
        setLoading(false);
        setError(allowedError.message);
        return;
      }

      if (!allowed) {
        setLoading(false);
        setError("This email hasn't been given access to this app.");
        return;
      }
    }

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
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-blue-500/20 bg-slate-900/70 p-6 shadow-xl shadow-blue-950/40 backdrop-blur">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold text-white">Voice Task List</h1>
          <p className="text-sm text-slate-400">
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
              className={inputClass}
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
                className={`${inputClass} text-center text-lg tracking-widest`}
              />
            )}

            <button type="submit" disabled={loading} className={primaryButtonClass}>
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
                className="w-full text-center text-sm text-slate-400 underline"
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
              className={inputClass}
            />

            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />

            <button type="submit" disabled={loading} className={primaryButtonClass}>
              {loading ? "Please wait..." : isSignUp ? "Sign up" : "Sign in"}
            </button>
          </form>
        )}

        {message && <p className="text-sm text-green-400">{message}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center justify-between text-sm text-slate-400">
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
