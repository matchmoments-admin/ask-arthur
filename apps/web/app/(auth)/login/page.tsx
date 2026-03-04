import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { featureFlags } from "@askarthur/utils/feature-flags";
import LoginForm from "./LoginForm";

export const metadata = {
  title: "Sign In — Ask Arthur",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!featureFlags.auth) {
    redirect("/");
  }

  const user = await getUser();
  if (user) {
    redirect("/app");
  }

  const { next } = await searchParams;

  return (
    <>
      <h1 className="text-deep-navy text-xl font-extrabold text-center mb-6">
        Sign in to your account
      </h1>
      <LoginForm redirectTo={next} />
      <p className="text-center text-sm text-gov-slate mt-6">
        Don&apos;t have an account?{" "}
        <a
          href="/signup"
          className="font-bold text-action-teal hover:underline"
        >
          Sign up
        </a>
      </p>
    </>
  );
}
