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
    <main
      className="relative flex min-h-screen w-full items-center justify-center p-4 bg-gradient-to-br from-slate-100 via-sky-50 to-blue-100 text-slate-900"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        background: "linear-gradient(135deg, #f1f5f9 0%, #e0f2fe 50%, #dbeafe 100%)",
        boxSizing: "border-box",
      }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200/90 bg-white p-7 shadow-2xl shadow-blue-900/10"
        style={{
          width: "100%",
          maxWidth: "380px",
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          padding: "28px",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)",
          border: "1px solid #e2e8f0",
          boxSizing: "border-box",
        }}
      >
        {/* Header Icon / Avatar + Titles */}
        <div
          className="flex flex-col items-center text-center mb-5"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginBottom: "20px",
          }}
        >
          {role === "client" ? (
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                overflow: "hidden",
                border: "2px solid #3b82f6",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                marginBottom: "12px",
                backgroundColor: "#eff6ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src="/avt.png"
                alt="AI Assistant"
                width={64}
                height={64}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center 12%",
                  display: "block",
                }}
              />
            </div>
          ) : (
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                backgroundColor: "#eff6ff",
                border: "1px solid #bfdbfe",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "12px",
                color: "#2563eb",
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "24px", height: "24px" }}
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
          )}

          <h1
            className="text-xl font-bold tracking-tight text-slate-900"
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "#0f172a",
              margin: "0 0 4px 0",
            }}
          >
            {role === "admin" ? "Admin sign in" : "AI Virtual Assistant"}
          </h1>
          <p
            className="text-xs text-slate-500"
            style={{
              fontSize: "13px",
              color: "#64748b",
              margin: 0,
            }}
          >
            {role === "admin"
              ? "Please sign in with administrator credentials"
              : "Please sign in to start your conversation"}
          </p>
        </div>

        {/* Username Field */}
        <div style={{ marginBottom: "16px" }}>
          <label
            htmlFor="login-username"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "#334155",
              marginBottom: "6px",
            }}
          >
            Username
          </label>
          <input
            id="login-username"
            name="username"
            type="text"
            placeholder="Enter username..."
            autoComplete="username"
            required
            disabled={submitting}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 14px",
              fontSize: "14px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#f8fafc",
              color: "#0f172a",
              outline: "none",
            }}
          />
        </div>

        {/* Password Field */}
        <div style={{ marginBottom: "20px" }}>
          <label
            htmlFor="login-password"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "#334155",
              marginBottom: "6px",
            }}
          >
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            placeholder="Enter password..."
            autoComplete="current-password"
            required
            disabled={submitting}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 14px",
              fontSize: "14px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#f8fafc",
              color: "#0f172a",
              outline: "none",
            }}
          />
        </div>

        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: "16px",
              padding: "10px 14px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              color: "#b91c1c",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg shadow-md shadow-blue-500/25 transition cursor-pointer"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px",
            fontSize: "14px",
            fontWeight: 600,
            borderRadius: "8px",
            border: "none",
            backgroundColor: submitting ? "#93c5fd" : "#2563eb",
            color: "#ffffff",
            cursor: submitting ? "not-allowed" : "pointer",
            boxShadow: "0 4px 6px -1px rgba(37, 99, 235, 0.2)",
          }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}