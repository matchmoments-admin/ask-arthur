"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "'Public Sans', sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px", textAlign: "center" }}>
          <h1 style={{ color: "#001F3F", fontSize: "2rem", fontWeight: 800, marginBottom: "12px" }}>
            Something Went Wrong
          </h1>
          <p style={{ color: "#42526E", fontSize: "16px", marginBottom: "32px", maxWidth: "400px" }}>
            A critical error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "12px 32px",
              backgroundColor: "#001F3F",
              color: "#FFFFFF",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
