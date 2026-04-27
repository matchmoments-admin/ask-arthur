import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-12"
      style={{ background: "#fbfbfa" }}
    >
      <Link
        href="/"
        className="inline-flex items-center gap-2 mb-8 group"
        aria-label="Ask Arthur home"
      >
        <span
          aria-hidden
          className="grid place-items-center text-white"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--color-deep-navy)",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2 4 5v6.5C4 16 7.5 19.7 12 22c4.5-2.3 8-6 8-10.5V5l-8-3z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </span>
        <span className="text-deep-navy font-semibold tracking-tight text-[17px]">
          askArthur
        </span>
      </Link>

      <div className="w-full max-w-[400px]">{children}</div>

      <p className="mt-10 text-[11px] text-slate-400 text-center max-w-[400px]">
        By continuing you agree to our{" "}
        <Link href="/terms" className="hover:text-deep-navy underline-offset-2 hover:underline">
          Terms
        </Link>{" "}
        &amp;{" "}
        <Link href="/privacy" className="hover:text-deep-navy underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
