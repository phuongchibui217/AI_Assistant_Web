"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { LoginRole } from "@/lib/server/login-sessions";

type LoginFormProps = {
  role: LoginRole;
};

export function LoginForm({ role }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      if (res.status === 401) {
        setError("Incorrect username or password.");
        return;
      }
      if (!res.ok) throw new Error("Sign-in failed");
      window.location.replace(role === "admin" ? "/admin" : "/");
    } catch {
      setError("Sign-in failed. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid h-screen w-screen place-items-center bg-black text-white">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-zinc-900/95 p-6 shadow-2xl border border-zinc-800/80"
      >
        <h1 className="text-base font-semibold text-white">
          {role === "admin" ? "Admin sign in" : "AI Virtual Assistant"}
        </h1>

        <div className="space-y-1">
          <label htmlFor="login-username" className="text-sm text-zinc-300">
            Username
          </label>
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            required
            disabled={submitting}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="login-password" className="text-sm text-zinc-300">
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={submitting}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        </div>

        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-md">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
