import { notFound } from "next/navigation";
import Link from "next/link";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import "highlight.js/styles/github.css";
import DOMPurify from "isomorphic-dompurify";
import {
  getPostBySlug,
  getAllSlugs,
  getRelatedPosts,
  CATEGORY_DISPLAY,
} from "@/lib/blog";
import SubscribeForm from "@/components/SubscribeForm";
import CopyLinkButton from "@/components/CopyLinkButton";
import PostCard from "@/components/blog/PostCard";
import type { Metadata } from "next";

// Register highlight.js languages
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    return { title: "Post Not Found — Ask Arthur Blog" };
  }

  return {
    title: `${post.seoTitle || post.title} — Ask Arthur Blog`,
    description: post.metaDescription || post.excerpt,
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.metaDescription || post.excerpt,
      type: "article",
      publishedTime: post.publishedAt,
      ...(post.updatedAt ? { modifiedTime: post.updatedAt } : {}),
      authors: [post.author],
    },
  };
}

export const revalidate = 3600;

/** Transform callout blockquotes and wrap images in figure/figcaption */
function transformMarkdown(html: string): string {
  // Transform callout blockquotes: > [!WARNING], > [!TIP], > [!DANGER]
  const calloutMap: Record<string, { bg: string; border: string; text: string; icon: string; label: string }> = {
    WARNING: {
      bg: "bg-warn-bg",
      border: "border-warn-border",
      text: "text-warn-heading",
      icon: "warning",
      label: "Warning",
    },
    DANGER: {
      bg: "bg-danger-bg",
      border: "border-danger-border",
      text: "text-danger-heading",
      icon: "error_outline",
      label: "Danger",
    },
    TIP: {
      bg: "bg-safe-bg",
      border: "border-safe-border",
      text: "text-safe-heading",
      icon: "verified_user",
      label: "Tip",
    },
  };

  let result = html;

  // Match blockquotes containing [!TYPE] pattern
  result = result.replace(
    /<blockquote>\s*<p>\[!(WARNING|DANGER|TIP)\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
    (_match, type: string, content: string) => {
      const key = type.toUpperCase();
      const style = calloutMap[key];
      if (!style) return _match;

      return `<div class="${style.bg} ${style.border} border-l-4 rounded-r-lg p-4 my-4">
        <div class="flex items-center gap-2 mb-1">
          <span class="material-symbols-outlined ${style.text} text-lg">${style.icon}</span>
          <span class="font-bold ${style.text} text-sm">${style.label}</span>
        </div>
        <div class="text-gov-slate text-sm">${content.trim()}</div>
      </div>`;
    }
  );

  // Wrap standalone images in figure/figcaption
  result = result.replace(
    /<p>\s*<img\s+src="([^"]+)"\s+alt="([^"]*)"[^>]*>\s*<\/p>/gi,
    (_match, src: string, alt: string) => {
      const caption = alt
        ? `<figcaption class="text-center text-xs text-slate-400 mt-2">${alt}</figcaption>`
        : "";
      return `<figure class="my-6"><img src="${src}" alt="${alt}" class="rounded-lg w-full" />${caption}</figure>`;
    }
  );

  return result;
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  // Set up marked with syntax highlighting
  const marked = new Marked(
    markedHighlight({
      emptyLangClass: "hljs",
      langPrefix: "hljs language-",
      highlight(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : "plaintext";
        return hljs.highlight(code, { language }).value;
      },
    })
  );

  const rawHtml = await marked.parse(post.content);
  const transformedHtml = transformMarkdown(rawHtml as string);
  const htmlContent = DOMPurify.sanitize(transformedHtml, {
    ADD_TAGS: ["figure", "figcaption"],
    ADD_ATTR: ["class"],
  });

  const relatedPosts = await getRelatedPosts(slug, post.category);

  // JSON-LD structured data for Google
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.metaDescription || post.excerpt,
    author: { "@type": "Organization", name: post.author },
    datePublished: post.publishedAt,
    ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
    publisher: {
      "@type": "Organization",
      name: "Ask Arthur",
      url: "https://askarthur.au",
    },
  };

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="mb-8">
        {/* Category pill */}
        <Link
          href={`/blog/category/${post.category}`}
          className="inline-block bg-action-teal/10 text-action-teal-text text-xs font-semibold px-2.5 py-1 rounded-full mb-3 hover:bg-action-teal/20 transition-colors"
        >
          {CATEGORY_DISPLAY[post.category] || post.category}
        </Link>

        <h1 className="text-deep-navy text-3xl font-extrabold mb-3">
          {post.title}
        </h1>

        {post.subtitle && (
          <p className="text-gov-slate text-lg italic mb-4">{post.subtitle}</p>
        )}

        <div className="flex items-center gap-3 text-xs text-slate-400 mb-4">
          <span>{post.author}</span>
          <span>&middot;</span>
          <time dateTime={post.publishedAt}>
            {new Date(post.publishedAt).toLocaleDateString("en-AU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </time>
          <span>&middot;</span>
          <span>{post.readingTime}</span>
          <span>&middot;</span>
          <CopyLinkButton />
        </div>

        {post.tags.length > 0 && (
          <div className="flex gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <div
        className="prose prose-slate max-w-none prose-headings:text-deep-navy prose-a:text-action-teal-text prose-a:no-underline hover:prose-a:underline"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />

      <hr className="my-12 border-border-light" />

      <div className="mb-8">
        <h3 className="text-deep-navy text-lg font-bold mb-2">
          Stay ahead of scammers
        </h3>
        <p className="text-gov-slate text-sm mb-4">
          Get weekly scam alerts delivered to your inbox. No spam, just
          protection.
        </p>
        <SubscribeForm />
      </div>

      {/* Related posts */}
      {relatedPosts.length > 0 && (
        <section className="mt-12">
          <h3 className="text-deep-navy text-lg font-bold mb-6">
            Related posts
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {relatedPosts.map((related) => (
              <PostCard key={related.slug} post={related} compact />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
