import { requireAdmin } from "@/lib/adminAuth";
import LinkedInDrafts from "./LinkedInDrafts";
export const dynamic = "force-dynamic";
export default async function LinkedInDraftsPage() {
  await requireAdmin();
  return <LinkedInDrafts />;
}
