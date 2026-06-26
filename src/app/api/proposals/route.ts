import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createCustomer, splitCustomerName } from '@/lib/lunarpay';
import { sendSms, sendEmail, findOrCreateContact, normalizePhone, getGhlToken } from '@/lib/ghl';
import { generateToken } from '@/lib/utils';
import { sendEmail as directSendEmail } from '@/lib/email';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import {
  normalizeLineItemsFromRequest,
  validateCouponForProposal,
  recordCouponRedemption,
} from '@/lib/venue-coupons-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = request.nextUrl.searchParams.get('limit');
  const status = request.nextUrl.searchParams.get('status');

  // Select only the columns needed for the proposals list — avoids
  // transferring large JSONB fields (content, signature_fields, line_items,
  // payment_config) for what is typically a 5–20 row table widget.
  // Sticks to the original public schema; fields like proposal_type,
  // deposit_pct, override_conflict don't exist on every install.
  const BASE_COLS =
    'id, public_token, customer_name, customer_email, customer_lunarpay_id, ' +
    'status, price, payment_type, sent_at, paid_at, signed_at, ' +
    'created_at, updated_at, template_id';

  async function runQuery(cols: string) {
    let q = supabaseAdmin
      .from('proposals')
      .select(cols)
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    if (limit) q = q.limit(parseInt(limit, 10));
    return q;
  }

  // Prefer to include collect_manually; fall back to the legacy column set if
  // migration 154 hasn't been applied yet.
  let { data, error } = await runQuery(BASE_COLS + ', collect_manually');
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    ({ data, error } = await runQuery(BASE_COLS));
  }

  if (error) {
    console.error('[proposals GET] supabase error', { venueId, code: error.code, message: error.message, details: error.details });
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  // Merge in manual-payment totals so the list can show paid/balance. Tolerant
  // of the proposal_payments table not existing yet.
  try {
    const { data: pays } = await supabaseAdmin
      .from('proposal_payments')
      .select('proposal_id, amount_cents')
      .eq('venue_id', venueId);
    if (pays && pays.length) {
      const totals = new Map<string, number>();
      for (const p of pays) {
        const pid = String(p.proposal_id);
        totals.set(pid, (totals.get(pid) ?? 0) + (Number(p.amount_cents) || 0));
      }
      for (const r of rows) {
        r.total_paid_cents = totals.get(String(r.id)) ?? 0;
      }
    }
  } catch { /* proposal_payments not available yet — skip totals */ }

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    templateId, customerName, customerEmail, customerPhone,
    ghlContactId, customerId,
    price, paymentType, paymentConfig,
    asDraft,
    acceptAch,
    lineItems: lineItemsRaw,
    appliedCouponId: appliedCouponIdRaw,
    overrideContent,
    collectManually,
    requireSignature,
  } = body;

  // Manual-collection proposals suppress the online payment form; the owner
  // records cash/check payments from the dashboard instead.
  const collectManuallyFlag = collectManually === true;
  const requireSignatureFlag = requireSignature !== false;

  // templateId is optional when overrideContent is provided (AI-generated or freeform contract)
  if (!templateId && !body.overrideContent) {
    return NextResponse.json({ error: 'templateId is required (or provide overrideContent for a freeform contract)' }, { status: 400 });
  }

  const isDraft = !!asDraft;

  const appliedCouponId =
    typeof appliedCouponIdRaw === 'string' && appliedCouponIdRaw.length > 0
      ? appliedCouponIdRaw
      : null;

  const lineItems = normalizeLineItemsFromRequest(lineItemsRaw);
  const shouldValidateLineItems =
    Boolean(appliedCouponId) || (Array.isArray(lineItemsRaw) && lineItemsRaw.length > 0);
  const priceCents = typeof price === 'number' && Number.isFinite(price) ? Math.round(price) : 0;

  if (shouldValidateLineItems) {
    const couponCheck = await validateCouponForProposal({
      venueId,
      appliedCouponId,
      lineItems,
      priceCents,
    });
    if (!couponCheck.ok) {
      return NextResponse.json({ error: couponCheck.error }, { status: 400 });
    }
  }

  if (!isDraft) {
    if (!customerName || !customerEmail) {
      return NextResponse.json(
        { error: 'customerName and customerEmail are required to send' },
        { status: 400 }
      );
    }
    if (!price || price <= 0) {
      return NextResponse.json({ error: 'A valid price is required' }, { status: 400 });
    }
  }

  const contentForProposal =
    typeof overrideContent === 'string' && overrideContent.trim().length > 0
      ? overrideContent
      : null;

  // Fetch venue, template, and signature fields in parallel — three
  // independent queries that used to run sequentially.
  const venueQuery = supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_location_id, name, email, brand_color, brand_logo_url')
    .eq('id', venueId)
    .single();

  let template: { content: string } | null = null;
  let sigFields: unknown[] = [];

  if (templateId) {
    const [
      { data: tmplData, error: templateError },
      { data: sigData },
    ] = await Promise.all([
      supabaseAdmin
        .from('proposal_templates')
        .select('content')
        .eq('id', templateId)
        .eq('venue_id', venueId)
        .single(),
      supabaseAdmin
        .from('proposal_template_fields')
        .select('id, field_type, label, sort_order, required, placeholder, options')
        .eq('template_id', templateId)
        .order('sort_order', { ascending: true }),
    ]);

    if (templateError || !tmplData) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    template = tmplData;
    sigFields = sigData ?? [];
  }

  const { data: venue } = await venueQuery;

  const resolvedContent = contentForProposal ?? template?.content ?? '';

  const publicToken = generateToken();

  const lineItemsPayload = shouldValidateLineItems ? lineItems : null;
  const appliedCouponPayload = shouldValidateLineItems ? appliedCouponId : null;

  // Insert tolerant of installs where migration 154 (manual payment columns)
  // hasn't run yet: retry once without collect_manually/require_signature.
  async function insertProposalRow(row: Record<string, unknown>) {
    let res = await supabaseAdmin.from('proposals').insert(row).select().single();
    if (res.error && (res.error.code === '42703' || res.error.code === 'PGRST204')) {
      const { collect_manually: _cm, require_signature: _rs, ...fallback } = row;
      void _cm; void _rs;
      res = await supabaseAdmin.from('proposals').insert(fallback).select().single();
    }
    return res;
  }

  if (isDraft) {
    const { data: proposal, error: insertError } = await insertProposalRow({
      venue_id: venueId,
      template_id: templateId ?? null,
      customer_name: customerName || null,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      content: resolvedContent,
      price: price || 0,
      payment_type: paymentType || 'full',
      payment_config: paymentConfig || {},
      accept_ach: acceptAch !== false,
      signature_fields: sigFields ?? [],
      public_token: publicToken,
      status: 'draft',
      line_items: lineItemsPayload,
      applied_coupon_id: appliedCouponPayload,
      collect_manually: collectManuallyFlag,
      require_signature: requireSignatureFlag,
    });

    if (insertError) {
      console.error('[proposals POST draft] insert failed', { venueId, code: insertError.code, message: insertError.message, details: insertError.details, hint: insertError.hint });
      return NextResponse.json({ error: insertError.message, code: insertError.code, hint: insertError.hint }, { status: 500 });
    }

    return NextResponse.json(proposal, { status: 201 });
  }

  // --- Sending flow ---

  // 1. Create LunarPay customer for payment processing
  let customerLunarpayId = customerId || null;

  if (venue?.lunarpay_secret_key && !customerLunarpayId) {
    try {
      const { firstName, lastName } = splitCustomerName(customerName, customerEmail);
      const lpResult = await createCustomer(venue.lunarpay_secret_key, {
        firstName,
        lastName,
        email: customerEmail,
        phone: customerPhone || undefined,
      });
      const lpCustomer = lpResult.data || lpResult;
      customerLunarpayId = lpCustomer.id;
    } catch (err) {
      console.error('[proposal-send] LunarPay customer creation failed:', err);
    }
  }

  // 2. Insert proposal
  const { data: proposal, error: insertError } = await insertProposalRow({
    venue_id: venueId,
    template_id: templateId ?? null,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone || null,
    customer_lunarpay_id: customerLunarpayId,
    content: resolvedContent,
    price,
    payment_type: paymentType || 'full',
    payment_config: paymentConfig || {},
    accept_ach: acceptAch !== false,
    signature_fields: sigFields ?? [],
    public_token: publicToken,
    status: 'sent',
    sent_at: new Date().toISOString(),
    line_items: lineItemsPayload,
    applied_coupon_id: appliedCouponPayload,
    collect_manually: collectManuallyFlag,
    require_signature: requireSignatureFlag,
  });

  if (insertError) {
    console.error('[proposals POST send] insert failed', { venueId, code: insertError.code, message: insertError.message, details: insertError.details, hint: insertError.hint });
    return NextResponse.json({ error: insertError.message, code: insertError.code, hint: insertError.hint }, { status: 500 });
  }

  if (appliedCouponPayload && proposal?.id) {
    const redeem = await recordCouponRedemption({
      venueId,
      couponId: appliedCouponPayload,
      proposalId: proposal.id,
      lineItems,
    });
    if (!redeem.ok) {
      console.error('[proposal-send] coupon redemption failed:', redeem.error);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const proposalUrl = `${appUrl}/proposal/${publicToken}`;

  // 3. Send via GHL (SMS + Email)
  // Use per-venue OAuth token if available; fall back to the shared GHL_PRIVATE_KEY
  // so venues that signed up via location ID get SMS without needing to OAuth connect.
  const ghlToken = venue ? getGhlToken(venue) : null;
  if (venue?.ghl_location_id && ghlToken) {
    try {
      // Find or use existing GHL contact
      let contactId = ghlContactId || null;

      if (!contactId) {
        const phoneE164 = normalizePhone(customerPhone) || undefined;
        contactId = await findOrCreateContact(
          ghlToken,
          venue.ghl_location_id,
          {
            email: customerEmail,
            phone: phoneE164,
            firstName: customerName.split(' ')[0],
            lastName: customerName.split(' ').slice(1).join(' ') || undefined,
          }
        );
      }

      if (contactId) {
        // Send SMS if customer has a phone number (must be valid E.164)
        const phoneE164 = normalizePhone(customerPhone);
        if (phoneE164) {
          try {
            await sendSms(
              ghlToken,
              venue.ghl_location_id,
              contactId,
              `Hi ${customerName.split(' ')[0]}, ${venue.name} has sent you a proposal. View and sign here: ${proposalUrl}`
            );
            console.log(`[proposal-send] SMS sent to contact ${contactId}`);
          } catch (smsErr) {
            console.error('[proposal-send] SMS failed:', smsErr);
          }
        }

        // Send email
        try {
          await sendEmail(
            ghlToken,
            venue.ghl_location_id,
            {
              contactId,
              subject: `Proposal from ${venue.name}`,
              html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1a1a2e;">You have a new proposal from ${venue.name}</h2>
                  <p style="color: #555; font-size: 16px; line-height: 1.6;">
                    Hi ${customerName.split(' ')[0]},<br><br>
                    ${venue.name} has prepared a proposal for you. Click the button below to review, sign, and complete your payment.
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${proposalUrl}" style="display: inline-block; background-color: #1b1b1b; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                      View Proposal
                    </a>
                  </div>
                  <p style="color: #999; font-size: 13px;">
                    If the button doesn't work, copy and paste this link: ${proposalUrl}
                  </p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                  <p style="color: #bbb; font-size: 12px; text-align: center;">
                    Sent via StoryVenue on behalf of ${venue.name}
                  </p>
                </div>
              `,
            }
          );
          console.log(`[proposal-send] Email sent to contact ${contactId}`);
        } catch (emailErr) {
          console.error('[proposal-send] Email failed:', emailErr);
        }
      } else {
        console.error('[proposal-send] Could not find or create GHL contact for', customerEmail);
      }
    } catch (err) {
      console.error('[proposal-send] GHL contact lookup failed:', err);
    }
  } else {
    console.log('[proposal-send] GHL not connected — sending direct email');
  }

  // Always send direct email using the venue's saved template
  if (customerEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const proposalUrl = `${appUrl}/proposal/${publicToken}`;

    // brand_color / brand_logo_url already fetched in the parallel pre-fetch above.
    const venueData = venue;

    const tmpl = await getVenueEmailTemplate(venueId, 'proposal');
    if (tmpl) {
      const venueName = venue?.name || 'Your Venue';
      const vars: Record<string, string> = {
        organization:   venueName,
        customer_name:  customerName,
        amount:         `$${((price ?? 0) / 100).toFixed(2)}`,
      };
      await directSendEmail({
        to: customerEmail,
        subject: fillTemplate(tmpl.subject, vars),
        html: buildEmailHtml({
          template: tmpl,
          vars,
          actionUrl: proposalUrl,
          brandColor: venueData?.brand_color || '#1b1b1b',
          logoUrl:    venueData?.brand_logo_url || undefined,
          venueName,
        }),
      });
    }
  }

  // Auto-apply proposal_sent tag
  if (customerEmail) {
    ensureSystemTagsForVenue(venueId)
      .then(() => applySystemTagByEmail(venueId, customerEmail, 'proposal_sent'))
      .catch(() => {});
  }

  return NextResponse.json(proposal, { status: 201 });
}
