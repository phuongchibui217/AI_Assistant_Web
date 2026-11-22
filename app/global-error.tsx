"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
          Application Error
        </h2>
        <p style={{ fontSize: "14px", color: "#64748b", maxWidth: "400px", marginBottom: "16px" }}>
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "10px 20px",
            fontSize: "14px",
            fontWeight: 600,
            backgroundColor: "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
