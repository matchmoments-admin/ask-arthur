import type { Metadata } from "next";
import ConfirmSubscription from "@/components/ConfirmSubscription";

export const metadata: Metadata = {
  title: "Confirm your subscription — Arthur’s Watch",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function ConfirmSubscriptionPage() {
  return <ConfirmSubscription />;
}
