/**
 * Shared writers for `marketing_automation_execution_logs`.
 *
 * - `logStepExecution`  — used by the workflow worker for real enrolled runs
 * - `logTestExecution`  — used by the "Send Test" buttons in the workflow
 *                         builder so test sends also appear in the same
 *                         per-workflow Execution Logs table.
 *
 * Both writers are best-effort: errors are logged to the console and
 * never thrown, so a logging failure can never block the underlying send.
 */

import { supabaseAdmin } from '@/lib/supabase';

export type ExecutionLogStatus = 'success' | 'failed' | 'skipped';

export async function logStepExecution(opts: {
  automation_id: string;
  enrollment_id: string | null;
  venue_id: string;
  lead_id: string | null;
  step_order: number;
  step_type: string;
  status: ExecutionLogStatus;
  error_text?: string;
}): Promise<void> {
  try {
    await supabaseAdmin.from('marketing_automation_execution_logs').insert({
      automation_id: opts.automation_id,
      enrollment_id: opts.enrollment_id,
      venue_id:      opts.venue_id,
      lead_id:       opts.lead_id,
      step_order:    opts.step_order,
      step_type:     opts.step_type,
      status:        opts.status,
      error_text:    opts.error_text ?? null,
      executed_at:   new Date().toISOString(),
      is_test:       false,
    });
  } catch (e) {
    console.error('[workflow-logs] logStepExecution failed (non-fatal):', e);
  }
}

export async function logTestExecution(opts: {
  automation_id: string;
  venue_id: string;
  step_order: number;
  step_type: string;
  status: ExecutionLogStatus;
  /** Recipient email or phone the test was delivered to. */
  recipient: string;
  error_text?: string;
}): Promise<void> {
  try {
    await supabaseAdmin.from('marketing_automation_execution_logs').insert({
      automation_id:  opts.automation_id,
      enrollment_id:  null,
      venue_id:       opts.venue_id,
      lead_id:        null,
      step_order:     opts.step_order,
      step_type:      opts.step_type,
      status:         opts.status,
      error_text:     opts.error_text ?? null,
      executed_at:    new Date().toISOString(),
      is_test:        true,
      test_recipient: opts.recipient,
    });
  } catch (e) {
    console.error('[workflow-logs] logTestExecution failed (non-fatal):', e);
  }
}
