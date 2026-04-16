import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { getPageSeo, buildMetadata } from '@/lib/page-seo';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPageSeo('privacy');
  return buildMetadata(seo, {
    title: 'Privacy Policy — StoryPay',
    description: 'How StoryPay collects, uses, and protects your information.',
    url: `${APP_URL}/privacy`,
  });
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
        <Link href="/">
          <Image src="/storypay-logo-dark.png" alt="StoryPay" width={110} height={26} />
        </Link>
        <a href={`${DASHBOARD_URL}/login`} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
          Sign In
        </a>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: April 12, 2026</p>

        <div className="prose prose-gray max-w-none space-y-8 text-sm leading-relaxed text-gray-700">

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">1. Introduction</h2>
            <p>StoryPay (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is a proposal and payment platform built for wedding venues. We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform and related services (collectively, the &ldquo;Services&rdquo;).</p>
            <p className="mt-2">By using our Services, you consent to the practices described in this policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">2. Information We Collect</h2>
            <p className="font-semibold mb-1">Account &amp; Business Information</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Name, email address, phone number, and business address</li>
              <li>Venue name and business information</li>
              <li>Team member names and email addresses</li>
              <li>Branding assets (logo, brand colors)</li>
            </ul>
            <p className="font-semibold mt-4 mb-1">Customer &amp; Transaction Data</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Customer names, emails, and phone numbers you enter into the platform</li>
              <li>Proposal and invoice content you create</li>
              <li>Payment transaction records and amounts</li>
              <li>Signed contract data and e-signature records</li>
            </ul>
            <p className="font-semibold mt-4 mb-1">Automatically Collected Information</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Device information (IP address, browser type, operating system)</li>
              <li>Usage data (pages visited, features used, time spent)</li>
              <li>Session cookies for authentication</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Operate and provide the StoryPay platform</li>
              <li>Send proposals, invoices, and payment links to your customers on your behalf</li>
              <li>Process payments through LunarPay (powered by Fortis)</li>
              <li>Send SMS notifications through your connected GHL account</li>
              <li>Generate reports on your revenue and business activity</li>
              <li>Deliver automated emails using your configured templates</li>
              <li>Provide customer support and respond to inquiries</li>
              <li>Improve and optimize the platform</li>
              <li>Comply with legal and regulatory requirements</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">4. Information Sharing</h2>
            <p>We may share your information with:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>LunarPay / Fortis:</strong> To process payments. Card data goes directly to Fortis and never touches our servers (PCI SAQ-A compliant).</li>
              <li><strong>Go High Level (GHL):</strong> To send SMS and email notifications to your customers when connected.</li>
              <li><strong>SendGrid / Resend:</strong> To deliver transactional emails.</li>
              <li><strong>OpenAI:</strong> To power the Ask AI assistant. Only non-identifying account context is shared.</li>
              <li><strong>Supabase:</strong> Our database and backend infrastructure provider.</li>
              <li><strong>Legal authorities:</strong> When required by law or to protect our rights.</li>
            </ul>
            <p className="mt-3">We do not sell your personal information or your customers&rsquo; information to third parties.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">5. Data Security</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>SSL/TLS encryption for all data in transit</li>
              <li>Secure, isolated database storage per venue</li>
              <li>PCI SAQ-A compliance — card numbers never touch StoryPay servers</li>
              <li>Session tokens stored in secure, httpOnly cookies</li>
              <li>Magic-link authentication — no passwords stored</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">6. Your Rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your personal information</li>
              <li>Opt-out of marketing communications</li>
              <li>Data portability</li>
            </ul>
            <p className="mt-3">To exercise these rights, contact us at <a href="mailto:clients@storyvenuemarketing.com" className="text-gray-900 underline">clients@storyvenuemarketing.com</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">7. Data Retention</h2>
            <p>We retain your information for as long as your account is active or as needed to provide Services. Transaction records are retained for a minimum of 7 years as required by financial regulations. You may request deletion of your account data, subject to legal retention requirements.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">8. Cookies</h2>
            <p>We use cookies solely for authentication (session management). We do not use advertising or third-party tracking cookies. You can manage cookies through your browser settings, but disabling them will prevent you from staying signed in.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">9. Children&apos;s Privacy</h2>
            <p>Our Services are intended for business use by adults (18+) and are not directed to children. We do not knowingly collect personal information from anyone under 18.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy and updating the &ldquo;Last updated&rdquo; date. Continued use of the Services after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">11. Contact Us</h2>
            <p>If you have questions about this Privacy Policy, contact us:</p>
            <div className="mt-2 bg-gray-50 rounded-xl p-4 text-sm">
              <p className="font-semibold">StoryPay</p>
              <p>Operated by Story Venue Marketing</p>
              <p>Email: <a href="mailto:clients@storyvenuemarketing.com" className="text-gray-900 underline">clients@storyvenuemarketing.com</a></p>
              <p>Website: <a href="https://storypay.io" className="text-gray-900 underline">storypay.io</a></p>
            </div>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
          <span>© {new Date().getFullYear()} StoryPay. All rights reserved.</span>
          <Link href="/terms" className="hover:text-gray-600 transition-colors">Terms of Use →</Link>
        </div>
      </main>
    </div>
  );
}
