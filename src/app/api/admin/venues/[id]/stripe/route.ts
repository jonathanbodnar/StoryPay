/**
 * GET  /api/admin/venues/[id]/stripe
 *   The venue's billing in the owner's Stripe account, read-only: the customer
 *   (linked on the venue, or matched by email), every subscription on it (the
 *   StoryVenue software plus any private-client ones) and the card on file.
 *
 * POST /api/admin/venues/[id]/stripe  { customerId: 'cus_…' }
 *   Links a Stripe customer by hand, for when the email match finds none or
 *   the wrong one. Refused while the venue's software subscription is billed
 *   to a different customer.
 */
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { getStripe, isStripeConfigured, stripeDashboardUrl } from '@/lib/stripe/client';
import { SAAS_KIND, loadBillingVenue } from '@/lib/stripe/billing';
import { defaultCardFor, findStripeCustomerByEmails } from '@/lib/stripe/lunarpay-migration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === 'string' ? x : x?.id ?? null);
const iso = (ts: number | null | undefined) => (ts ? new Date(ts * 1000).toISOString() : null);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ configured: false });

  const { id } = await params;
  const v = await loadBillingVenue(id);
  if (!v) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  try {
    const stripe = getStripe();
    const linked = Boolean(v.stripe_customer_id);
    const customerId = v.stripe_customer_id ?? (await findStripeCustomerByEmails([v.email, v.notification_email]));
    if (!customerId) return NextResponse.json({ configured: true, customer: null, subscriptions: [], card: null });

    const [customer, subs, card] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 25, expand: ['data.default_payment_method'] }),
      defaultCardFor(customerId),
    ]);
    if ('deleted' in customer && customer.deleted) {
      return NextResponse.json({ configured: true, customer: null, subscriptions: [], card: null, note: `Customer ${customerId} was deleted in Stripe.` });
    }

    const productIds = Array.from(
      new Set(subs.data.flatMap((s) => s.items.data.map((it) => idOf(it.price.product as string | Stripe.Product)).filter((x): x is string => Boolean(x)))),
    );
    const products = productIds.length ? (await stripe.products.list({ ids: productIds, limit: 100 })).data : [];
    const productName = new Map(products.map((p) => [p.id, p.name]));

    const subscriptions = subs.data.map((s) => {
      const price = s.items.data[0]?.price;
      const pm = s.default_payment_method && typeof s.default_payment_method !== 'string' ? s.default_payment_method : null;
      return {
        id: s.id,
        status: s.status,
        amount_cents: s.items.data.reduce((sum, it) => sum + (it.price.unit_amount ?? 0) * (it.quantity ?? 1), 0),
        interval: price?.recurring ? `${price.recurring.interval_count > 1 ? `${price.recurring.interval_count} ` : ''}${price.recurring.interval}` : null,
        items: s.items.data.map((it) => productName.get(idOf(it.price.product as string | Stripe.Product) ?? '') ?? it.price.nickname ?? 'Item'),
        next_charge_on: s.status === 'canceled' ? null : iso(s.status === 'trialing' ? s.trial_end : s.items.data[0]?.current_period_end),
        cancel_at: iso(s.cancel_at),
        ended_at: iso(s.ended_at),
        card: pm?.card ? { brand: pm.card.brand, last4: pm.card.last4 } : null,
        is_storyvenue: s.metadata?.sv_kind === SAAS_KIND || s.id === v.stripe_subscription_id,
        url: stripeDashboardUrl(`subscriptions/${s.id}`),
      };
    });

    return NextResponse.json({
      configured: true,
      customer: {
        id: customer.id,
        name: customer.name ?? null,
        email: customer.email ?? null,
        linked,
        url: stripeDashboardUrl(`customers/${customer.id}`),
      },
      subscriptions,
      card,
    });
  } catch (e) {
    return NextResponse.json({ error: `Stripe error: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { customerId?: string };
  const customerId = String(body.customerId ?? '').trim();
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) {
    return NextResponse.json({ error: 'Enter a Stripe customer id (cus_…).' }, { status: 400 });
  }
  const v = await loadBillingVenue(id);
  if (!v) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const stripe = getStripe();
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch {
    return NextResponse.json({ error: `No customer ${customerId} in your Stripe account (check test vs live).` }, { status: 404 });
  }
  if ('deleted' in customer && customer.deleted) {
    return NextResponse.json({ error: `Customer ${customerId} was deleted in Stripe.` }, { status: 400 });
  }

  if (v.stripe_subscription_id) {
    const sub = await stripe.subscriptions.retrieve(v.stripe_subscription_id).catch(() => null);
    const billedTo = sub ? idOf(sub.customer as string | Stripe.Customer) : null;
    if (sub && sub.status !== 'canceled' && billedTo && billedTo !== customerId) {
      return NextResponse.json(
        { error: `This venue's StoryVenue subscription is billed to ${billedTo}. Cancel or move it before linking another customer.` },
        { status: 409 },
      );
    }
  }

  const { error } = await supabaseAdmin.from('venues').update({ stripe_customer_id: customerId }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Adds one key; the customer's other metadata is left as is.
  await stripe.customers.update(customerId, { metadata: { storyvenue_venue_id: id } }).catch(() => {});
  return NextResponse.json({ ok: true, customerId });
}
