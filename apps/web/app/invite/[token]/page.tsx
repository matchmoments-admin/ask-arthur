"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function InviteAcceptPage() {
  const params = useParams();
  const token = params.token as string;

  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [orgName, setOrgName] = useState("");
  const [role, setRole] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function acceptInvite() {
      try {
        const res = await fetch("/api/org/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();

        if (!res.ok) {
          setState("error");
          setErrorMsg(data.error ?? "Failed to accept invitation");
          return;
        }

        setState("success");
        setOrgName(data.orgName);
        setRole(data.role?.replace("_", " ") ?? "member");
      } catch {
        setState("error");
        setErrorMsg("Something went wrong. Please try again.");
      }
    }

    acceptInvite();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-5">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="block text-center font-extrabold text-sm uppercase tracking-wide text-deep-navy mb-8"
        >
          Ask Arthur
        </Link>

        <div className="bg-white rounded-2xl border border-border-light p-8 text-center">
          {state === "loading" && (
            <>
              <Loader2 size={48} className="mx-auto text-trust-teal animate-spin mb-4" />
              <h1 className="text-xl font-bold text-deep-navy mb-2">
                Accepting invitation...
              </h1>
              <p className="text-gov-slate text-sm">Please wait while we set up your access.</p>
            </>
          )}

          {state === "success" && (
            <>
              <CheckCircle size={48} className="mx-auto text-safe-green mb-4" />
              <h1 className="text-xl font-bold text-deep-navy mb-2">
                Welcome to {orgName}!
              </h1>
              <p className="text-gov-slate text-sm mb-6">
                You&apos;ve joined as a <span className="font-medium">{role}</span>.
              </p>
              <Link
                href="/app"
                className="inline-block bg-trust-teal text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-trust-teal/90 transition-colors"
              >
                Go to Dashboard
              </Link>
            </>
          )}

          {state === "error" && (
            <>
              <XCircle size={48} className="mx-auto text-danger-red mb-4" />
              <h1 className="text-xl font-bold text-deep-navy mb-2">
                Invitation Error
              </h1>
              <p className="text-gov-slate text-sm mb-6">{errorMsg}</p>
              <div className="flex gap-3 justify-center">
                <Link
                  href="/login"
                  className="inline-block bg-deep-navy text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-deep-navy/90 transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/"
                  className="inline-block border border-border-light text-gov-slate px-6 py-3 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  Home
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
