import { notFound } from "next/navigation";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import { getPostBySlug, getAllSlugs } from "@/lib/blog";
import SubscribeForm from "@/components/SubscribeForm";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    return { title: "Post Not Found — Ask Arthur Blog" };
  }

  return {
    title: `${post.title} — Ask Arthur Blog`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.publishedAt,
      authors: [post.author],
    },
  };
}

export const revalidate = 3600;

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const rawHtml = await marked(post.content);
  const htmlContent = DOMPurify.sanitize(rawHtml);

  // JSON-LD structured data for Google
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    author: { "@type": "Organization", name: post.author },
    datePublished: post.publishedAt,
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
        <h1 className="text-deep-navy text-3xl font-extrabold mb-3">
          {post.title}
        </h1>
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
    </article>
  );
}
