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
    <>
      <h1 className="text-deep-navy text-xl font-extrabold text-center mb-6">
        Create your account
      </h1>
      <SignupForm />
      <p className="text-center text-sm text-gov-slate mt-6">
        Already have an account?{" "}
        <a href="/login" className="font-bold text-action-teal hover:underline">
          Sign in
        </a>
      </p>
    </>
  );
}
