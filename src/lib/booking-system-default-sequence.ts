/**
 * The Booking System's "Guide Delivered → 14-Day Sequence" (Speed to Lead) is
 * ON by default: the Booking System page shows it on, with these default
 * texts, before the owner has saved anything.
 *
 * It used to exist only once the owner clicked Save on that page, so a venue
 * that never saved it had no sequence at all and its leads were never
 * followed up. ensureSpeedToLeadAutomation now creates it the first time a
 * lead needs it. A venue that turned it off keeps it off (its row is
 * 'paused'), and so does one with the whole Booking System switched off.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { STL_NAME } from '@/lib/booking-system-sequences';

export interface StepConfig {
  id?:          string;   // existing step row id (undefined for new rows)
  step_order:   number;
  step_type:    'send_sms' | 'send_email' | 'delay' | 'start_ai_concierge';
  label:        string;   // friendly label shown in the UI
  // send_sms / send_email
  body?:        string;
  subject?:     string;
  preview_text?: string;
  image_url?:   string;
  image_link?:  string;
  button_text?: string;
  button_link?: string;
  // delay (1-3 days only for booking system)
  delay_minutes?: number;
}

// ─── Phase 2 default — "Guide Delivered → 14-Day Sequence" ─────────────────
// Alternating [delay, sms, delay, sms, ...]; each delay is the increment from
// the previous touch (deltas: 1,1,1,2,2,3,4 days → Day 1,2,3,5,7,10,14).
export const DEFAULT_PHASE2_STEPS: StepConfig[] = [
  { step_order: 0,  step_type: 'delay',    label: 'Wait 1 day',  delay_minutes: 1 * 1440 },
  { step_order: 1,  step_type: 'send_sms', label: 'Day 1',
    body: `Hi {{first_name}}! It's {{owner_name}} over at {{venue_name}}, just making sure the pricing and availability guide landed in your inbox ok? 😊 And do you have a date in mind yet? Happy to peek at the calendar and see if it's still open for you!` },
  { step_order: 2,  step_type: 'delay',    label: 'Wait 1 day',  delay_minutes: 1 * 1440 },
  { step_order: 3,  step_type: 'send_sms', label: 'Day 2',
    body: `Hey {{first_name}}, this is {{owner_name}} from {{venue_name}}. Saw you downloaded our guide! Just making sure it reached you ok? And do you have a date picked out yet? Happy to check if it's still open for you.` },
  { step_order: 4,  step_type: 'delay',    label: 'Wait 1 day',  delay_minutes: 1 * 1440 },
  { step_order: 5,  step_type: 'send_sms', label: 'Day 3',
    body: `Hi {{first_name}}! Totally get that looking at venues can feel like a lot. If it's easier, just tell me the one thing you're trying to figure out right now and I'll help with that.` },
  { step_order: 6,  step_type: 'delay',    label: 'Wait 2 days', delay_minutes: 2 * 1440 },
  { step_order: 7,  step_type: 'send_sms', label: 'Day 5',
    body: `Hi {{first_name}}! Okay, fun question. 😊 Are you picturing spring blooms, summer sunsets, or cozy fall vibes for your wedding?` },
  { step_order: 8,  step_type: 'delay',    label: 'Wait 2 days', delay_minutes: 2 * 1440 },
  { step_order: 9,  step_type: 'send_sms', label: 'Day 7',
    body: `Hey {{first_name}}! Feels like there might be a few things easier to just talk through than text back and forth. Want to hop on a quick 5-min call? Whenever's good for you, no pressure at all.` },
  { step_order: 10, step_type: 'delay',    label: 'Wait 3 days', delay_minutes: 3 * 1440 },
  { step_order: 11, step_type: 'send_sms', label: 'Day 10',
    body: `Hey {{first_name}}, there's so much that goes into planning your wedding day. 😊 Please don't feel like you have to figure it all out by yourself. I'd love to help however I can.` },
  { step_order: 12, step_type: 'delay',    label: 'Wait 4 days', delay_minutes: 4 * 1440 },
  { step_order: 13, step_type: 'send_sms', label: 'Day 14',
    body: `Hi {{first_name}}! When you reached out about {{venue_name}}, I didn't want to just send a guide and disappear on you. So I wanted to check in one more time, is there anything you're still wondering about that I can help with?` },
];

/** marketing_automation_steps rows for a Booking System sequence (same shape the Booking System page saves). */
export function bookingStepRows(automationId: string, steps: StepConfig[]) {
  return steps.map((s, i) => ({
    automation_id: automationId,
    step_order:    i,
    step_type:     s.step_type,
    config_json:   {
      label:         s.label,
      body:          s.body          ?? '',
      subject:       s.subject       ?? '',
      preview_text:  s.preview_text  ?? '',
      image_url:     s.image_url     ?? '',
      image_link:    s.image_link    ?? '',
      button_text:   s.button_text   ?? '',
      button_link:   s.button_link   ?? '',
      delay_minutes: s.delay_minutes ?? 0,
      mode:          s.step_type === 'send_email' ? 'quick' : undefined,
    },
  }));
}

/**
 * Create the default 14-day sequence for a venue that has never saved one.
 * Returns true when it was created. Safe to race: the database allows one per
 * venue (migration 265), so a second concurrent insert just fails.
 */
export async function ensureSpeedToLeadAutomation(venueId: string): Promise<boolean> {
  const { data: existing } = await supabaseAdmin
    .from('marketing_automations')
    .select('id')
    .eq('venue_id', venueId)
    .eq('name', STL_NAME)
    .limit(1);
  if (existing?.length) return false;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('booking_system_enabled')
    .eq('id', venueId)
    .maybeSingle();
  if ((venue as { booking_system_enabled?: boolean | null } | null)?.booking_system_enabled === false) return false;

  const { data: created, error } = await supabaseAdmin
    .from('marketing_automations')
    .insert({ venue_id: venueId, name: STL_NAME, status: 'active', trigger_type: 'form_submitted', trigger_config: {} })
    .select('id')
    .single();
  if (error || !created) return false; // another lead created it a moment ago

  const { error: stepErr } = await supabaseAdmin
    .from('marketing_automation_steps')
    .insert(bookingStepRows(created.id as string, DEFAULT_PHASE2_STEPS));
  if (stepErr) {
    // No half-made sequence: remove it so the next lead tries again.
    console.error('[booking-system] default 14-day sequence steps failed:', venueId, stepErr.message);
    await supabaseAdmin.from('marketing_automations').delete().eq('id', created.id);
    return false;
  }
  console.log(`[booking-system] created the default 14-day sequence for venue ${venueId}`);
  return true;
}
