import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import {
  collectMonthlyIntelFacts,
  factsAreTooThin,
  generateMonthlyIntelPost,
} from "@/lib/monthly-intel-blog";
import { createGhostDraft } from "@/lib/ghost-admin";
import { renderMarkdown } from "@/lib/blogRenderer";

/**
 * Monthly Intel Blog — one data-driven draft post per month.
 *
 * Replaces the retired weekly-blog Vercel cron (silent no-op since 2026-05 —
 * its only input, verified_scams over 7 days, was empty every Monday).
 * Mines the prior calendar month across ALL intel streams (Reddit intel,
 * competitor-newsletter observations, clone-watch, regulator feeds, consumer
 * reports), asks Sonnet for 10 ranked ideas + a full draft of idea #1, and
 * lands the draft in Ghost for human review/edit. Publishing from Ghost
 * flows through the existing ghost-webhook mirror into blog_posts and
 * triggers newsletter delivery. If Ghost is unavailable the draft falls back
 * to a blog_posts status='draft' row so the month's output is never lost.
 *
 * Runs on the 2nd of the month (after the 1st-of-month clone-watch stats
 * snapshot + brand-stewardship). Expected duration well under 2 minutes: a
 * handful of bounded queries + one Claude call. Gated by
 * FF_MONTHLY_INTEL_BLOG (default OFF); no auto-publish ever.
 */

function priorMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}

export const monthlyIntelBlog = inngest.createFunction(
  {
    id: "monthly-intel-blog",
    name: "Blog: monthly intel-driven draft",
    timeouts: { finish: "4m" },
    retries: 2,
  },
  [
    { cron: "0 20 2 * *" }, // 2nd of month, 20:00 UTC = 6am AEST on the 3rd
    // Manual re-run; optional event.data.periodMonth ("YYYY-MM") overrides
    // the window, e.g. { periodMonth: "2026-06" }.
    { event: "blog/monthly-intel.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "monthly-intel-blog" }, async ({ event, step }) => {
    if (!featureFlags.monthlyIntelBlog) {
      return { skipped: true, reason: "FF_MONTHLY_INTEL_BLOG disabled" };
    }

    const periodOverride = (
      event?.data as { periodMonth?: string } | undefined
    )?.periodMonth;

    const period = await step.run("compute-period", async () => {
      const start = periodOverride
        ? new Date(`${periodOverride}-01T00:00:00Z`)
        : priorMonthStart(new Date());
      const end = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
      );
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    });

    const facts = await step.run("collect-facts", () =>
      collectMonthlyIntelFacts(period.startIso, period.endIso)
    );
    if (!facts) {
      return { skipped: true, reason: "database not configured" };
    }
    if (factsAreTooThin(facts)) {
      logger.warn("monthly-intel-blog: month too thin to draft", {
        periodMonth: facts.periodMonth,
      });
      return { skipped: true, reason: "insufficient data", periodMonth: facts.periodMonth };
    }

    const generated = await step.run("generate", () =>
      generateMonthlyIntelPost(facts)
    );
    if (!generated) {
      // step.run already retried; a null here is a validation/parse failure.
      await sendAdminTelegramMessage(
        `⚠️ Monthly intel blog (${facts.periodMonth}): generation failed validation — no draft created. Re-run with blog/monthly-intel.manual-trigger.v1.`
      );
      return { skipped: true, reason: "generation failed" };
    }

    const persisted = await step.run("persist-draft", async () => {
      const html = await renderMarkdown(generated.content);
      const ghost = await createGhostDraft({
        title: generated.title,
        html,
        excerpt: generated.excerpt,
        tags: generated.tags,
      });
      if (ghost) {
        return { via: "ghost" as const, reviewUrl: ghost.editorUrl };
      }

      // Fallback: never lose the month's draft. Same row shape the retired
      // weekly-blog cron wrote; /admin/blog can flip it once Ghost is back.
      const sb = createServiceClient();
      if (!sb) return { via: "none" as const, reviewUrl: null };
      const { error } = await sb.from("blog_posts").upsert(
        {
          slug: generated.slug,
          title: generated.title,
          subtitle: generated.subtitle,
          excerpt: generated.excerpt,
          content: generated.content,
          tags: generated.tags,
          author: "Arthur AI",
          published: false,
          status: "draft",
          category: generated.category,
          reading_time_minutes: generated.readingTimeMinutes,
          published_at: new Date().toISOString(),
        },
        { onConflict: "slug" }
      );
      if (error) {
        logger.error("monthly-intel-blog: fallback upsert failed", {
          error: error.message,
        });
        return { via: "none" as const, reviewUrl: null };
      }
      return {
        via: "blog_posts" as const,
        reviewUrl: "https://askarthur.au/admin/blog",
      };
    });

    await step.run("notify-admin", async () => {
      const runnerUps = generated.ideas
        .slice(1, 10)
        .map((i, n) => `${n + 2}. ${i.title}`)
        .join("\n");
      const where =
        persisted.via === "ghost"
          ? `Ghost draft ready to review/edit:\n${persisted.reviewUrl}`
          : persisted.via === "blog_posts"
            ? `Ghost unavailable — draft saved to blog_posts (review at ${persisted.reviewUrl})`
            : "⚠️ PERSIST FAILED — draft was generated but not saved";
      await sendAdminTelegramMessage(
        [
          `📝 Monthly intel blog — ${facts.periodMonth}`,
          ``,
          `Draft: "${generated.title}"`,
          where,
          ``,
          `Runner-up ideas this month:`,
          runnerUps,
        ].join("\n")
      );
    });

    return {
      periodMonth: facts.periodMonth,
      slug: generated.slug,
      persistedVia: persisted.via,
      ideaCount: generated.ideas.length,
    };
  })
);
