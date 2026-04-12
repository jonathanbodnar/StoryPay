import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { getPageSeo, buildMetadata } from '@/lib/page-seo';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getPageSeo('terms');
  return buildMetadata(seo, {
    title: 'Terms of Use — StoryPay',
    description: 'Terms governing your use of the StoryPay platform.',
    url: `${APP_URL}/terms`,
  });
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
        <Link href="/">
          <Image src="/storypay-logo-dark.png" alt="StoryPay" width={110} height={26} />
        </Link>
        <Link href="/login" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
          Sign In
        </Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Use</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: April 12, 2026</p>

        <div className="prose prose-gray max-w-none space-y-8 text-sm leading-relaxed text-gray-700">

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">1. Acceptance of Terms</h2>
            <p>Welcome to StoryPay. These Terms of Use (&ldquo;Terms&rdquo;) govern your access to and use of StoryPay&rsquo;s proposal and payment platform, including our website, dashboard, APIs, and related services (collectively, the &ldquo;Services&rdquo;), operated by Story Venue Marketing.</p>
            <p className="mt-2">By accessing or using our Services, you agree to be bound by these Terms. If you do not agree, you may not access or use the Services.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">2. Eligibility</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>You must be at least 18 years old</li>
              <li>You must have the legal capacity to enter into a binding agreement</li>
              <li>You must be a legitimate business entity or authorized representative</li>
              <li>You must provide accurate and complete registration information</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">3. Account Registration &amp; Access</h2>
            <p>Access to StoryPay is provided by invitation from Story Venue Marketing. When your account is created, you receive a secure login link by email. You agree to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Keep your login credentials and links confidential</li>
              <li>Not share your login link with unauthorized persons</li>
              <li>Accept responsibility for all activity under your account</li>
              <li>Notify us immediately of any unauthorized access at <a href="mailto:clients@storyvenuemarketing.com" className="text-gray-900 underline">clients@storyvenuemarketing.com</a></li>
            </ul>
            <p className="mt-3">You may invite team members through Settings → Team. You are responsible for your team members&rsquo; compliance with these Terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">4. Platform Services</h2>
            <p>StoryPay provides tools for wedding venues to create and send proposals and invoices, collect e-signatures, process payments, manage customers, and communicate with clients. By using the Services you agree to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Only send proposals and invoices for legitimate goods and services you provide</li>
              <li>Comply with all applicable laws, regulations, and payment network rules</li>
              <li>Maintain accurate records of all transactions</li>
              <li>Handle customer disputes, refunds, and chargebacks appropriately</li>
              <li>Only upload and send content you have the right to use</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">5. Payment Processing</h2>
            <p>Payment processing is provided through LunarPay (powered by Fortis). By accepting payments through StoryPay, you acknowledge that:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Payment processing is subject to LunarPay&rsquo;s and Fortis&rsquo;s terms and conditions</li>
              <li>Card data goes directly to Fortis — StoryPay never stores cardholder data</li>
              <li>You must complete merchant onboarding before accepting payments</li>
              <li>Processing fees apply as described in your account agreement</li>
              <li>You are responsible for refunds, chargebacks, and disputes with your customers</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">6. Prohibited Activities</h2>
            <p>You may not use StoryPay to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Process transactions for illegal goods or services</li>
              <li>Engage in fraudulent, deceptive, or misleading practices</li>
              <li>Send unsolicited communications (spam) to customers</li>
              <li>Violate any applicable laws or third-party rights</li>
              <li>Attempt to gain unauthorized access to our systems or other accounts</li>
              <li>Upload malware, viruses, or harmful code</li>
              <li>Impersonate another person or entity</li>
              <li>Engage in money laundering or any illegal financial activity</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">7. Your Content</h2>
            <p>You retain ownership of all content you create in StoryPay — including proposal templates, invoices, customer data, branding assets, and email templates. By uploading content, you grant us a limited license to use it solely to provide the Services. You represent that you have all rights necessary to upload and use such content.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">8. SMS Messaging</h2>
            <p>StoryPay may send SMS messages to your customers using your connected GHL (Go High Level) account and A2P-registered phone number. You are responsible for ensuring you have proper consent from your customers to receive SMS communications as required by applicable law (including TCPA).</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">9. Intellectual Property</h2>
            <p>The StoryPay platform, including its software, design, and documentation, is owned by Story Venue Marketing. You may not copy, modify, distribute, or create derivative works from our platform without express written permission. Our name, logo, and trademarks may not be used without prior authorization.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">10. Privacy</h2>
            <p>Your use of the Services is governed by our <Link href="/privacy" className="text-gray-900 underline">Privacy Policy</Link>, which is incorporated into these Terms by reference.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">11. Disclaimer of Warranties</h2>
            <p className="uppercase text-xs tracking-wide font-semibold text-gray-500">Our Services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, either express or implied. We disclaim all warranties including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Services will be uninterrupted, error-free, or completely secure.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">12. Limitation of Liability</h2>
            <p className="uppercase text-xs tracking-wide font-semibold text-gray-500">To the maximum extent permitted by law, Story Venue Marketing shall not be liable for any indirect, incidental, special, consequential, or punitive damages. Our total liability for any claim arising from these Terms shall not exceed the fees paid by you in the 12 months preceding the claim.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">13. Indemnification</h2>
            <p>You agree to indemnify and hold harmless Story Venue Marketing, its affiliates, officers, and employees from any claims, damages, or expenses (including legal fees) arising from your use of the Services, your violation of these Terms, or your violation of any third-party rights.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">14. Termination</h2>
            <p>Either party may terminate this agreement at any time. We may suspend or terminate your access immediately if you violate these Terms, engage in fraudulent activity, or as required by law. Upon termination, you remain responsible for any outstanding obligations.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">15. Modifications</h2>
            <p>We may update these Terms at any time. We will notify you of material changes by posting the updated Terms and updating the &ldquo;Last updated&rdquo; date. Continued use of the Services constitutes acceptance of the modified Terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">16. Governing Law</h2>
            <p>These Terms are governed by the laws of the State of Ohio, without regard to conflict of law provisions. Any disputes arising from these Terms shall be resolved in the state or federal courts located in Ohio.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">17. Miscellaneous</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Entire Agreement:</strong> These Terms constitute the entire agreement between you and Story Venue Marketing regarding StoryPay.</li>
              <li><strong>Severability:</strong> If any provision is found unenforceable, the remaining provisions continue in effect.</li>
              <li><strong>Waiver:</strong> Our failure to enforce any right does not constitute a waiver of that right.</li>
              <li><strong>Assignment:</strong> You may not assign your rights under these Terms without our consent.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">18. Contact Us</h2>
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
          <Link href="/privacy" className="hover:text-gray-600 transition-colors">← Privacy Policy</Link>
        </div>
      </main>
    </div>
  );
}
