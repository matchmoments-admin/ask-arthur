import { notFound, redirect } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { LinkClient } from "./LinkClient";

export const metadata = {
  title: "Link your extension — Ask Arthur",
};

// Landing page for the extension's "Link account" action. The extension
// mints a single-use token (/api/extension/link-token) and opens this page;
// once the user is logged in, the client component consumes the token via
// /api/extension/link. PR 6 adds the Extension Pro plan card + checkout here.
export default async function ExtensionLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!featureFlags.extensionBilling) {
    notFound();
  }

  const { token } = await searchParams;

  let user;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      redirect("/login?reason=auth_unavailable");
    }
    throw err;
  }
  if (!user) {
    const next = token
      ? `/extension/link?token=${encodeURIComponent(token)}`
      : "/extension/link";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="min-h-screen bg-[#fbfbfa] flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Link your extension
        </h1>
        <p className="text-sm text-gray-600 mb-8">
          Connecting the Ask Arthur extension to your account keeps your plan
          and limits in sync across devices.
        </p>
        <LinkClient token={token ?? null} userEmail={user.email ?? ""} />
      </div>
    </main>
  );
}
