import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { supabaseAdmin } from '@/lib/supabase';
import { getPageSeo, buildMetadata } from '@/lib/page-seo';
import { Calendar, User, ArrowRight } from 'lucide-react';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPageSeo('blog');
  return buildMetadata(seo, {
    title: 'Blog — Wedding Venue Business Tips & Resources',
    description: 'Practical guides, tips, and resources for wedding venue owners. Learn how to streamline proposals, improve client communication, and grow your venue business.',
    url: `${APP_URL}/blog`,
  });
}

interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  meta_description: string | null;
  featured_image: string | null;
  author_name: string;
  category: string | null;
  tags: string[];
  published_at: string | null;
}

async function getPosts(): Promise<Post[]> {
  try {
    const { data } = await supabaseAdmin
      .from('blog_posts')
      .select('id, slug, title, excerpt, meta_description, featured_image, author_name, category, tags, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50);
    return (data ?? []) as Post[];
  } catch { return []; }
}

function formatDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function BlogPage() {
  const posts = await getPosts();
  const featured = posts[0];
  const rest = posts.slice(1);

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: APP_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${APP_URL}/blog` },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/">
            <Image src="/storypay-logo-dark.png" alt="StoryPay" width={110} height={26} />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/blog" className="font-medium text-gray-900">Blog</Link>
            <Link href="/login" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Log In</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Wedding Venue Resources</h1>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            Practical guides and tips to help wedding venue owners streamline operations, delight clients, and grow revenue.
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">No posts yet — check back soon.</p>
          </div>
        ) : (
          <>
            {/* Featured post */}
            {featured && (
              <Link href={`/blog/${featured.slug}`} className="group block mb-12 rounded-2xl border border-gray-200 overflow-hidden hover:border-gray-300 hover:transition-all">
                <div className="grid md:grid-cols-2">
                  {featured.featured_image && (
                    <div className="relative h-56 md:h-auto">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={featured.featured_image} alt={featured.title} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-8 flex flex-col justify-center">
                    {featured.category && (
                      <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">{featured.category}</span>
                    )}
                    <h2 className="text-2xl font-bold text-gray-900 mb-3 group-hover:text-[#1b1b1b] transition-colors">{featured.title}</h2>
                    <p className="text-gray-500 text-sm leading-relaxed mb-4 line-clamp-3">{featured.excerpt || featured.meta_description}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><User size={12} /> {featured.author_name}</span>
                      <span className="flex items-center gap-1"><Calendar size={12} /> {formatDate(featured.published_at)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* Grid */}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {rest.map(post => (
                  <Link key={post.id} href={`/blog/${post.slug}`}
                    className="group rounded-2xl border border-gray-200 overflow-hidden hover:border-gray-300 hover:transition-all flex flex-col">
                    {post.featured_image && (
                      <div className="h-44 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={post.featured_image} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      </div>
                    )}
                    <div className="p-5 flex flex-col flex-1">
                      {post.category && (
                        <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">{post.category}</span>
                      )}
                      <h3 className="text-base font-bold text-gray-900 mb-2 group-hover:text-black transition-colors line-clamp-2">{post.title}</h3>
                      <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 flex-1">{post.excerpt || post.meta_description}</p>
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                        <span className="text-xs text-gray-400">{formatDate(post.published_at)}</span>
                        <span className="text-xs font-semibold text-gray-700 flex items-center gap-1 group-hover:gap-2 transition-all">Read <ArrowRight size={11} /></span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 mt-16">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <span>© {new Date().getFullYear()} StoryPay™ by StoryVenue</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-gray-600">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-gray-600">Terms of Use</Link>
            <Link href="/" className="hover:text-gray-600">Back to home</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
