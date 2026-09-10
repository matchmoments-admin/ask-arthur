import { requireAdmin } from "@/lib/adminAuth";
import NewsletterEditor from "./NewsletterEditor";
export const dynamic = "force-dynamic";
export default async function NewsletterPage() {
  await requireAdmin();
  return <NewsletterEditor />;
}
