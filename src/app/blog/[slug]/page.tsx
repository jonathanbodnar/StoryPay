import { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabaseAdmin } from '@/lib/supabase';
import { Calendar, User, Tag, ArrowLeft, ArrowRight } from 'lucide-react';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

interface Post {
  id: string; slug: string; title: string; meta_title: string | null;
  meta_description: string | null; og_image: string | null; excerpt: string | null;
  content: string; author_name: string; author_image: string | null;
  category: string | null; tags: string[]; featured_image: string | null;
  noindex: boolean; published_at: string | null; updated_at: string;
}

async function getPost(slug: string): Promise<Post | null> {
  try {
    const { data } = await supabaseAdmin
      .from('blog_posts')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();
    return data as Post | null;
  } catch { return null; }
}

async function getRelatedPosts(post: Post): Promise<Post[]> {
  try {
    const { data } = await supabaseAdmin
      .from('blog_posts')
      .select('id, slug, title, excerpt, featured_image, published_at, author_name')
      .eq('status', 'published')
      .eq('category', post.category || '')
      .neq('id', post.id)
      .limit(3);
    return (data ?? []) as Post[];
  } catch { return []; }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: 'Post Not Found' };

  const title = post.meta_title || post.title;
  const description = post.meta_description || post.excerpt || '';
  const image = post.og_image || post.featured_image || '/og-default.png';
  const url = `${APP_URL}/blog/${slug}`;

  return {
    title,
    description,
    robots: post.noindex ? { index: false, follow: false } : { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      publishedTime: post.published_at || undefined,
      modifiedTime: post.updated_at,
      authors: [post.author_name],
      tags: post.tags,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export async function generateStaticParams() {
  try {
    const { data } = await supabaseAdmin
      .from('blog_posts')
      .select('slug')
      .eq('status', 'published');
    return (data ?? []).map((p: { slug: string }) => ({ slug: p.slug }));
  } catch { return []; }
}

function formatDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Parse headings from HTML content for table of contents */
function extractHeadings(html: string) {
  const matches = [...html.matchAll(/<h([23])[^>]*id="([^"]*)"[^>]*>(.*?)<\/h[23]>/gi)];
  return matches.map(m => ({ level: parseInt(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') }));
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const related = await getRelatedPosts(post);
  const headings = extractHeadings(post.content);
  const url = `${APP_URL}/blog/${slug}`;

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description || post.excerpt || '',
    image: post.og_image || post.featured_image || `${APP_URL}/og-default.png`,
    author: { '@type': 'Person', name: post.author_name },
    publisher: { '@type': 'Organization', name: 'StoryPay', logo: { '@type': 'ImageObject', url: `${APP_URL}/storypay-logo-dark.png` } },
    datePublished: post.published_at || post.updated_at,
    dateModified: post.updated_at,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: APP_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${APP_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/"><Image src="/storypay-logo-dark.png" alt="StoryPay" width={110} height={26} /></Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/blog" className="text-gray-500 hover:text-gray-800 transition-colors">← Blog</Link>
            <Link href="/login" className="rounded-lg border border-gray-200 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 transition-colors">Log In</Link>
          </div>
        </div>
      </nav>

      {/* Breadcrumb */}
      <div className="max-w-5xl mx-auto px-6 py-3">
        <nav className="text-xs text-gray-400 flex items-center gap-1.5">
          <Link href="/" className="hover:text-gray-600">Home</Link>
          <span>/</span>
          <Link href="/blog" className="hover:text-gray-600">Blog</Link>
          <span>/</span>
          <span className="text-gray-600 truncate max-w-[200px]">{post.title}</span>
        </nav>
      </div>

      <main className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid lg:grid-cols-[1fr_280px] gap-12 items-start">

          {/* Article */}
          <article>
            {/* Header */}
            <header className="mb-8">
              {post.category && (
                <Link href={`/blog?category=${encodeURIComponent(post.category)}`}
                  className="inline-block text-xs font-semibold uppercase tracking-widest text-gray-400 hover:text-gray-700 mb-3 transition-colors">
                  {post.category}
                </Link>
              )}
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-4">{post.title}</h1>
              {(post.excerpt || post.meta_description) && (
                <p className="text-lg text-gray-500 leading-relaxed mb-5">{post.excerpt || post.meta_description}</p>
              )}
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400 pb-6 border-b border-gray-100">
                <span className="flex items-center gap-1.5">
                  {post.author_image
                    ? <img src={post.author_image} alt={post.author_name} className="h-6 w-6 rounded-full object-cover" />
                    : <User size={14} />}
                  {post.author_name}
                </span>
                {post.published_at && (
                  <span className="flex items-center gap-1.5"><Calendar size={14} />{formatDate(post.published_at)}</span>
                )}
                {post.tags?.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag size={14} />
                    {post.tags.map(t => (
                      <Link key={t} href={`/blog?tag=${encodeURIComponent(t)}`}
                        className="hover:text-gray-700 transition-colors">{t}</Link>
                    ))}
                  </div>
                )}
              </div>
            </header>

            {/* Featured image */}
            {post.featured_image && (
              <div className="mb-8 rounded-2xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={post.featured_image} alt={post.title} className="w-full object-cover max-h-[480px]" />
              </div>
            )}

            {/* Content */}
            <div
              className="prose prose-gray max-w-none prose-headings:font-bold prose-headings:text-gray-900 prose-p:text-gray-700 prose-p:leading-relaxed prose-a:text-[#1b1b1b] prose-a:underline prose-li:text-gray-700 prose-img:rounded-xl"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            {/* Tags */}
            {post.tags?.length > 0 && (
              <div className="mt-10 pt-6 border-t border-gray-100 flex flex-wrap gap-2">
                {post.tags.map(t => (
                  <Link key={t} href={`/blog?tag=${encodeURIComponent(t)}`}
                    className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors">
                    #{t}
                  </Link>
                ))}
              </div>
            )}

            {/* Related posts */}
            {related.length > 0 && (
              <div className="mt-12 pt-8 border-t border-gray-100">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Related Articles</h2>
                <div className="grid sm:grid-cols-3 gap-5">
                  {related.map(r => (
                    <Link key={r.id} href={`/blog/${r.slug}`} className="group">
                      {r.featured_image && (
                        <div className="h-32 rounded-xl overflow-hidden mb-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.featured_image} alt={r.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        </div>
                      )}
                      <p className="text-sm font-semibold text-gray-900 group-hover:underline line-clamp-2">{r.title}</p>
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">{formatDate(r.published_at)} <ArrowRight size={10} /></p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </article>

          {/* Sidebar: Table of Contents */}
          {headings.length > 0 && (
            <aside className="hidden lg:block sticky top-8">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">On this page</p>
                <nav className="space-y-1.5">
                  {headings.map(h => (
                    <a key={h.id} href={`#${h.id}`}
                      className={`block text-sm text-gray-500 hover:text-gray-900 transition-colors leading-snug ${h.level === 3 ? 'pl-3' : ''}`}>
                      {h.text}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>
          )}
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-[#1b1b1b] text-white p-10 text-center">
          <h2 className="text-2xl font-bold mb-3">Ready to streamline your venue business?</h2>
          <p className="text-white/70 mb-6 max-w-lg mx-auto">StoryPay handles proposals, contracts, e-signatures, and payments — so you can focus on your clients.</p>
          <Link href="/" className="inline-block rounded-xl bg-white text-gray-900 px-6 py-3 text-sm font-bold hover:bg-gray-100 transition-colors">
            Get Started with StoryPay <ArrowRight size={14} className="inline ml-1" />
          </Link>
        </div>
      </main>

      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <span>© {new Date().getFullYear()} StoryPay™ by StoryVenue</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-gray-600">Terms of Use</Link>
            <Link href="/blog" className="hover:text-gray-600">Blog</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
