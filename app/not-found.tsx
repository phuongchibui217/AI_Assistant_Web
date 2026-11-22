import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
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
      <h1 style={{ fontSize: "48px", fontWeight: 800, margin: "0 0 8px 0", color: "#3b82f6" }}>
        404
      </h1>
      <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 8px 0" }}>
        Page Not Found
      </h2>
      <p style={{ fontSize: "14px", color: "#64748b", maxWidth: "400px", margin: "0 0 20px 0" }}>
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-block",
          padding: "10px 20px",
          fontSize: "14px",
          fontWeight: 600,
          backgroundColor: "#2563eb",
          color: "#ffffff",
          textDecoration: "none",
          borderRadius: "8px",
        }}
      >
        Go to Home
      </Link>
    </main>
  );
}
