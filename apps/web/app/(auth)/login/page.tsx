import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { gateOrRedirect } from "@/lib/featureGate";
import LoginForm from "./LoginForm";

export const metadata = {
  title: "Sign In — Ask Arthur",
};

// Feature gates must be evaluated per REQUEST, not per build. Without this a
// statically prerendered route bakes the flag's build-time value into HTML: the
// page keeps serving 200 after the flag is turned off, and stays 404 after it is
// turned on until something triggers a rebuild. That is not hypothetical —
// /charity-check served 200 while both of its API routes returned 503
// feature_disabled, so every search a user ran failed. Enforced by
// __tests__/featureGateRuntime.test.ts.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  gateOrRedirect("auth", "/");

  const user = await getUser();
  if (user) {
    redirect("/app");
  }

  const { next } = await searchParams;

  return (
    <div
      className="bg-white"
      style={{
        border: "1px solid #eef0f3",
        borderRadius: 14,
        padding: "32px 32px 28px",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <div className="mb-6">
        <h1 className="text-deep-navy text-[22px] font-semibold tracking-tight leading-tight">
          Sign in to askArthur
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          Welcome back. Continue to your dashboard.
        </p>
      </div>
      <LoginForm redirectTo={next} />
      <div className="mt-7 pt-5 border-t" style={{ borderColor: "#eef0f3" }}>
        <p className="text-center text-sm text-slate-500">
          Don&apos;t have an account?{" "}
          <a
            href="/signup"
            className="text-deep-navy font-medium hover:underline underline-offset-2"
          >
            Create one
          </a>
        </p>
      </div>
    </div>
  );
}
