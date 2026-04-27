import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import SignupForm from "./SignupForm";

export const metadata = {
  title: "Sign Up — Ask Arthur",
};

export default async function SignupPage() {
  if (!featureFlags.auth) {
    redirect("/");
  }

  const user = await getUser();
  if (user) {
    redirect("/app");
  }

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
          Create your account
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          Free to start. No card required.
        </p>
      </div>
      <SignupForm />
      <div className="mt-7 pt-5 border-t" style={{ borderColor: "#eef0f3" }}>
        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <a
            href="/login"
            className="text-deep-navy font-medium hover:underline underline-offset-2"
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
