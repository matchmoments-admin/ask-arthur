"use client";
import { useState } from "react";
import Link from "next/link";

export default function ConfirmSubscription() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  async function confirm() {
    setStatus("loading");
    try {
      const token = window.location.hash.slice(1);
      const res = await fetch("/api/subscribe/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        setMessage(res.status === 400
          ? "This link has expired or has already been used. You can request a fresh link."
          : "We couldn’t confirm right now. Please try again shortly.");
        setStatus("error");
        return;
      }
      window.history.replaceState(null, "", window.location.pathname);
      setStatus("success");
    } catch {
      setMessage("We couldn’t confirm right now. Please try again shortly.");
      setStatus("error");
    }
  }
  return (
    <main className="max-w-[640px] mx-auto px-5 py-16 text-gov-slate">
      <Link href="/" className="font-bold text-deep-navy">Ask Arthur</Link>
      <h1 className="text-3xl font-bold text-deep-navy mt-8 mb-4">
        {status === "success" ? "Welcome to Arthur’s Watch" : "Confirm your subscription"}
      </h1>
      {status === "success" ? (
        <div role="status">
          <p>You&apos;re subscribed to our free weekly scam update. One useful lesson and a practical next step, straight to your inbox.</p>
          <p className="mt-6">Something suspicious already? <Link href="/" className="underline text-deep-navy">Try the free checker.</Link></p>
          <p className="mt-4"><Link href="/unsubscribe" className="underline">You can unsubscribe any time.</Link></p>
        </div>
      ) : (
        <>
          <p>Press the button below to receive Arthur&apos;s Watch at the address that received this link.</p>
          <button onClick={confirm} disabled={status === "loading"} className="mt-6 rounded bg-deep-navy text-white px-6 py-3 font-bold disabled:opacity-50">
            {status === "loading" ? "Confirming…" : "Confirm subscription"}
          </button>
          {status === "error" && <p role="alert" className="mt-4 text-danger-text">{message} <Link href="/subscribe" className="underline">Request a new link.</Link></p>}
        </>
      )}
    </main>
  );
}
