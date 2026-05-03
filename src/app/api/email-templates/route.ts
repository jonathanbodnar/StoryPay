import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const DEFAULT_TEMPLATES: Record<string, {
  label: string;
  description: string;
  icon: string;
  variables: string[];
  defaults: { subject: string; heading: string; body: string; button_text?: string; footer?: string };
}> = {
  invoice: {
    label: 'Invoice',
    description: 'Invoice sent to customers',
    icon: 'FileText',
    variables: ['{{contact.first_name}}', '{{contact.full_name}}', '{{contact.email}}', '{{invoice.number}}', '{{invoice.amount}}', '{{invoice.due_date}}', '{{venue.name}}'],
    defaults: {
      subject: 'Invoice {{invoice_number}} from {{organization}} - {{amount}}',
      heading: 'Invoice {{invoice_number}}',
      body: 'Hi {{customer_name}},\n\nYou have a new invoice from {{organization}}.\n\nPlease review and complete your payment at your earliest convenience.',
      button_text: 'View & Pay Invoice',
    },
  },
  proposal: {
    label: 'Proposal',
    description: 'Proposal sent to customers',
    icon: 'FileSignature',
    variables: ['{{contact.first_name}}', '{{contact.full_name}}', '{{contact.email}}', '{{proposal.amount}}', '{{venue.name}}'],
    defaults: {
      subject: 'Proposal from {{organization}}',
      heading: 'Your Proposal is Ready',
      body: 'Hi {{customer_name}},\n\n{{organization}} has sent you a proposal. Please review, sign, and complete your payment to secure your date.',
      button_text: 'View & Sign Proposal',
    },
  },
  payment_confirmation: {
    label: 'Payment Confirmation',
    description: 'Receipt sent to customers after payment',
    icon: 'CreditCard',
    variables: ['{{contact.first_name}}', '{{contact.full_name}}', '{{payment.amount}}', '{{payment.date}}', '{{payment.method}}', '{{venue.name}}'],
    defaults: {
      subject: 'Payment receipt from {{organization}} - {{amount}}',
      heading: 'Payment Successful',
      body: 'Hi {{customer_name}},\n\nYour payment of {{amount}} to {{organization}} has been processed successfully.\n\nThank you for your payment!',
    },
  },
  payment_notification: {
    label: 'Payment Notification',
    description: 'Notification sent to you when you receive a payment',
    icon: 'Bell',
    variables: ['{{contact.full_name}}', '{{contact.email}}', '{{payment.amount}}', '{{payment.net_amount}}', '{{payment.fee}}', '{{venue.name}}'],
    defaults: {
      subject: 'Payment received: {{amount}} from {{customer_name}}',
      heading: 'New Payment Received',
      body: "You've received a new payment for {{organization}}.\n\nCustomer: {{customer_name}}\nAmount: {{amount}}",
      button_text: 'View in Dashboard',
    },
  },
  subscription_confirmation: {
    label: 'Subscription Confirmation',
    description: 'Confirmation when a customer subscribes',
    icon: 'RefreshCw',
    variables: ['{{contact.first_name}}', '{{contact.full_name}}', '{{subscription.amount}}', '{{subscription.frequency}}', '{{subscription.next_payment_date}}', '{{venue.name}}'],
    defaults: {
      subject: 'Subscription confirmed with {{organization}}',
      heading: 'Subscription Confirmed',
      body: 'Hi {{customer_name}},\n\nYour subscription with {{organization}} is now active.\n\nAmount: {{amount}} {{frequency}}\nNext payment: {{next_payment_date}}',
    },
  },
  subscription_cancelled: {
    label: 'Subscription Cancelled',
    description: 'Confirmation when a subscription is cancelled',
    icon: 'XCircle',
    variables: ['{{contact.first_name}}', '{{contact.full_name}}', '{{venue.name}}'],
    defaults: {
      subject: 'Subscription cancelled - {{organization}}',
      heading: 'Subscription Cancelled',
      body: 'Hi {{customer_name}},\n\nYour subscription with {{organization}} has been cancelled as requested.',
    },
  },
  payment_failed: {
    label: 'Payment Failed',
    description: 'Notification when a payment fails',
    icon: 'AlertTriangle',
    variables: ['{{contact.first_name}}', '{{contact.full_name}}', '{{payment.amount}}', '{{payment.reason}}', '{{venue.name}}'],
    defaults: {
      subject: 'Action required: Payment failed - {{organization}}',
      heading: 'Payment Failed',
      body: 'Hi {{customer_name}},\n\nWe were unable to process your payment of {{amount}} to {{organization}}.\n\nReason: {{reason}}\n\nPlease update your payment method.',
      button_text: 'Update Payment Method',
    },
  },
  payment_reminder: {
    label: 'Payment Reminder',
    description: 'Overdue reminder sent after each installment due date',
    icon: 'Bell',
    variables: ['{{contact.first_name}}', '{{contact.full_name}}', '{{payment.amount}}', '{{invoice.due_date}}', '{{payment.overdue_by}}', '{{venue.name}}'],
    defaults: {
      subject: 'Payment overdue: {{amount}} was due {{due_date}} - {{organization}}',
      heading: 'Payment overdue',
      body: 'Hi {{customer_name}},\n\nThis is a friendly reminder that a payment to {{organization}} is now overdue.\n\nAmount due: {{amount}}\nOriginal due date: {{due_date}}\n\nPlease complete your payment at your earliest convenience.',
      button_text: 'View & Pay Now',
    },
  },
  document_viewed: {
    label: 'Proposal / Invoice Viewed',
    description: 'Notification sent to you when a customer opens their proposal or invoice',
    icon: 'Eye',
    variables: ['{{contact.full_name}}', '{{contact.email}}', '{{venue.name}}'],
    defaults: {
      subject: '{{customer_name}} just viewed their document — {{organization}}',
      heading: 'Document Viewed',
      body: 'Good news — {{customer_name}} just opened their proposal or invoice from {{organization}}.\n\nNow is a great time to follow up if they have any questions.',
      button_text: 'View in Dashboard',
    },
  },
  proposal_signed: {
    label: 'Proposal Signed',
    description: 'Notification sent to you when a customer signs a proposal',
    icon: 'FileSignature',
    variables: ['{{contact.full_name}}', '{{contact.email}}', '{{proposal.amount}}', '{{venue.name}}'],
    defaults: {
      subject: '{{contact.full_name}} signed a proposal — {{venue.name}}',
      heading: 'Proposal Signed',
      body: '{{customer_name}} just signed a proposal with {{organization}}.\n\nAmount: {{amount}}\n\nReview the signed proposal and reach out to confirm next steps.',
      button_text: 'View Proposal',
    },
  },
};

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: saved } = await supabaseAdmin
    .from('venue_email_templates')
    .select('*')
    .eq('venue_id', venueId);

  const savedMap = Object.fromEntries((saved ?? []).map(t => [t.type, t]));

  // Merge saved with defaults
  const templates = Object.entries(DEFAULT_TEMPLATES).map(([type, meta]) => ({
    type,
    label: meta.label,
    description: meta.description,
    icon: meta.icon,
    variables: meta.variables,
    subject:     savedMap[type]?.subject     ?? meta.defaults.subject,
    heading:     savedMap[type]?.heading     ?? meta.defaults.heading,
    body:        savedMap[type]?.body        ?? meta.defaults.body,
    button_text: savedMap[type]?.button_text ?? meta.defaults.button_text ?? '',
    footer:      savedMap[type]?.footer      ?? '',
    enabled:     savedMap[type]?.enabled     ?? true,
  }));

  return NextResponse.json(templates);
}
