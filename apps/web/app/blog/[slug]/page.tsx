import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import "highlight.js/styles/github.css";
import sanitizeHtml from "sanitize-html";
import { getPostBySlug, getAllSlugs, getRelatedPosts } from "@/lib/blog";
import { renderMarkdown } from "@/lib/blogRenderer";
import CopyLinkButton from "@/components/CopyLinkButton";
import MermaidDiagram from "@/components/blog/MermaidDiagram";
import SubscribeForm from "@/components/SubscribeForm";
import Pill from "@/components/Pill";
import { featureFlags } from "@askarthur/utils/feature-flags";
import type { Metadata } from "next";

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
    return { title: "Post Not Found — Ask Arthur" };
  }

  return {
    title: `${post.seoTitle || post.title} — Ask Arthur`,
    description: post.metaDescription || post.excerpt,
    alternates: {
      canonical: `https://askarthur.au/blog/${slug}`,
    },
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.metaDescription || post.excerpt,
      type: "article",
      publishedTime: post.publishedAt,
      ...(post.heroImageUrl && { images: [post.heroImageUrl] }),
    },
  };
}

export const revalidate = 3600;
export const dynamicParams = true;

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const related = await getRelatedPosts(slug, post.categorySlug);
  // Ghost-mirrored posts arrive as pre-rendered HTML; legacy posts are
  // markdown. Sanitize either source uniformly so trust boundaries don't
  // shift based on origin.
  const sourceHtml = post.contentHtml ?? (await renderMarkdown(post.content));
  const htmlContent = sanitizeHtml(sourceHtml, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "figure",
      "figcaption",
      "img",
      "span",
      "pre",
      "code",
      "iframe",
      "div",
      "svg",
      "path",
      "circle",
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["class"],
      img: ["src", "alt", "loading"],
      a: ["href", "target", "rel"],
      iframe: ["src", "title", "allow", "allowfullscreen"],
      div: ["class", "data-mermaid-source"],
      svg: ["xmlns", "width", "height", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"],
      path: ["d"],
      circle: ["cx", "cy", "r"],
    },
  });

  const breadcrumbItems = [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://askarthur.au/" },
    { "@type": "ListItem", position: 2, name: "Blog", item: "https://askarthur.au/blog" },
  ];
  if (post.categoryName && post.categorySlug) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: post.categoryName,
      item: `https://askarthur.au/blog?category=${post.categorySlug}`,
    });
  }
  breadcrumbItems.push({
    "@type": "ListItem",
    position: breadcrumbItems.length + 1,
    name: post.title,
    item: `https://askarthur.au/blog/${slug}`,
  });

  const wordCount = post.content.split(/\s+/).length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        headline: post.title,
        description: post.metaDescription || post.excerpt,
        author: {
          "@type": "Person",
          name: "Brendan Milton",
          url: "https://askarthur.au/about",
          jobTitle: "Founder & Technical Lead",
        },
        datePublished: post.publishedAt,
        ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
        publisher: {
          "@type": "Organization",
          name: "Ask Arthur",
          url: "https://askarthur.au",
          logo: {
            "@type": "ImageObject",
            url: "https://askarthur.au/icon/128.png",
          },
        },
        ...(post.heroImageUrl && { image: post.heroImageUrl }),
        wordCount,
        ...(post.categoryName && { articleSection: post.categoryName }),
        ...(post.tags.length > 0 && { keywords: post.tags.join(", ") }),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbItems,
      },
    ],
  };

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb — minimal */}
      <nav className="text-xs text-slate-400 mb-8">
        <Link
          href="/blog"
          className="hover:text-action-teal transition-colors"
        >
          Blog
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-slate-500">{post.title}</span>
      </nav>

      {/* Hero image */}
      {post.heroImageUrl && (
        <div className="mb-8 rounded-sm overflow-hidden bg-slate-50">
          <Image
            src={post.heroImageUrl}
            alt={post.heroImageAlt || post.title}
            width={1200}
            height={630}
            className="w-full h-auto rounded-xl"
            priority
          />
        </div>
      )}

      {/* Title block */}
      <header className="mb-10">
        <h1 className="text-deep-navy text-[2.25rem] font-extrabold tracking-tight leading-[1.15] mb-3">
          {post.title}
        </h1>

        {post.subtitle && (
          <p className="text-slate-500 text-lg italic leading-relaxed mb-6">
            {post.subtitle}
          </p>
        )}

        {/* Metadata row — label + value pairs */}
        <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-sm pt-5 border-t border-border-light">
          {post.categoryName && (
            <div>
              <span className="text-slate-400 text-xs uppercase tracking-wider block mb-0.5">
                Category
              </span>
              <Pill
                label={post.categoryName}
                slug={post.categorySlug}
                href={`/blog?category=${post.categorySlug}`}
              />
            </div>
          )}

          {post.product && (
            <div>
              <span className="text-slate-400 text-xs uppercase tracking-wider block mb-0.5">
                Product
              </span>
              <span className="text-deep-navy font-medium">
                {post.product}
              </span>
            </div>
          )}

          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wider block mb-0.5">
              Date
            </span>
            <time
              dateTime={post.publishedAt}
              className="text-deep-navy font-medium"
            >
              {new Date(post.publishedAt).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </time>
          </div>

          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wider block mb-0.5">
              Reading time
            </span>
            <span className="text-deep-navy font-medium">
              {post.readingTimeMinutes} min
            </span>
          </div>

          <div>
            <span className="text-slate-400 text-xs uppercase tracking-wider block mb-0.5">
              Share
            </span>
            <CopyLinkButton />
          </div>
        </div>
      </header>

      {/* Article body */}
      <div
        className="blog-content"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
      <MermaidDiagram />

      {/* Related posts */}
      {related.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border-light">
          <h2 className="text-deep-navy text-xl font-bold mb-6">
            Related posts
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {related.map((rp) => (
              <Link
                key={rp.slug}
                href={`/blog/${rp.slug}`}
                className="group block"
              >
                {rp.heroImageUrl && (
                  <div className="mb-3 rounded-sm overflow-hidden bg-slate-50 aspect-[16/10]">
                    <Image
                      src={rp.heroImageUrl}
                      alt={rp.heroImageAlt || rp.title}
                      width={800}
                      height={500}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  </div>
                )}
                <time
                  dateTime={rp.publishedAt}
                  className="text-xs text-slate-400 block mb-1"
                >
                  {new Date(rp.publishedAt).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </time>
                <h3 className="text-deep-navy font-bold text-base leading-snug group-hover:text-action-teal transition-colors">
                  {rp.title}
                </h3>
                {rp.categoryName && (
                  <span className="mt-1 block">
                    <Pill label={rp.categoryName} slug={rp.categorySlug} />
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Bottom CTA */}
      <section className="mt-16 pt-10 border-t border-border-light text-center">
        <h2 className="text-deep-navy text-xl font-bold mb-2">
          Think you&apos;ve received a scam?
        </h2>
        <p className="text-slate-500 text-base mb-5">
          Check it instantly — free, private, no signup.
        </p>
        <Link
          href="/"
          className="block w-full max-w-md mx-auto py-3.5 bg-deep-navy text-white font-bold text-sm uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors text-center"
        >
          Check now
        </Link>
      </section>

      {/* Newsletter — feature-flagged */}
      {featureFlags.newsletter && (
        <section className="mt-12 max-w-md mx-auto">
          <h3 className="text-deep-navy text-lg font-bold mb-1">
            Stay ahead of scams
          </h3>
          <p className="text-slate-500 text-sm mb-4">
            Weekly alerts delivered to your inbox every Monday.
          </p>
          <SubscribeForm variant="inline" />
        </section>
      )}
    </article>
  );
}
