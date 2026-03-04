import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="block text-center text-deep-navy font-extrabold text-lg uppercase tracking-wide mb-8"
        >
          Ask Arthur
        </Link>
        {children}
      </div>
    </div>
  );
}
