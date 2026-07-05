/**
 * StoryVenue MCP (Model Context Protocol) Server
 *
 * Exposes admin-only read tools that Viktor AI (app.viktor.com) can call from
 * Slack. Viktor configures this URL in their "Add Custom MCP Server" dialog:
 *   https://app.storyvenue.com/api/mcp
 *
 * Auth: Bearer token in the `Authorization` header.
 * Set MCP_API_KEY in Railway environment variables. If the env var is absent
 * (e.g. local dev before the variable is configured), auth is skipped so the
 * server is testable immediately after deploy.
 *
 * Protocol: JSON-RPC 2.0 over HTTP.
 *   GET  /api/mcp  — server discovery (returns server info + capabilities)
 *   POST /api/mcp  — JSON-RPC method dispatch (initialize, tools/list, tools/call)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { FUNNEL_STAGES, venueStageReached, type VenueFunnelState } from '@/lib/funnel-stage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function checkAuth(req: NextRequest): boolean {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) return true; // skip auth when env var not configured

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return token === apiKey;
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpcOk(id: unknown, result: unknown): Record<string, any> {
  return { jsonrpc: '2.0', id, result };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpcErr(id: unknown, code: number, message: string): Record<string, any> {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function textContent(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'get_venue_overview',
    description:
      'Get an overview of all venues on the platform including counts by plan, trial status, and funnel stage',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_venues',
    description:
      'List venues with their plan, subscription status, and funnel stage. Supports filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['trialing', 'active', 'free', 'all'],
          description: 'Filter by subscription status (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Max venues to return (default 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_funnel_stats',
    description:
      'Get conversion funnel statistics showing how many venues are at each stage from signup to paid',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_lead_stats',
    description: 'Get lead statistics across all venues for a given time period',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default 7)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_unread_conversations',
    description: 'Get conversations with unread messages from brides across all venues',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max conversations to return (default 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_venue_detail',
    description: 'Get detailed information about a specific venue by name or ID',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Venue name search string or UUID',
        },
      },
      required: ['query'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolGetVenueOverview() {
  const [{ data: venues }, { data: plans }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select(
        'id, directory_plan_id, directory_subscription_status, directory_trial_ends_at, ' +
          'directory_trial_consumed, is_published, onboarding_last_step, ' +
          'onboarding_completed_at, onboarding_activated_at, directory_subscription_external_id',
      ),
    supabaseAdmin.from('directory_plans').select('id, name, slug'),
  ]);

  const planById = new Map((plans ?? []).map((p) => [p.id as string, p.name as string]));
  const rows = (venues ?? []) as unknown as Record<string, unknown>[];

  // Count by subscription status
  const byStatus: Record<string, number> = {};
  for (const v of rows) {
    const s = (v.directory_subscription_status as string) || 'none';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }

  // Count by plan
  const byPlan: Record<string, number> = {};
  for (const v of rows) {
    const pid = v.directory_plan_id as string | null;
    const planName = pid ? (planById.get(pid) ?? pid) : 'no_plan';
    byPlan[planName] = (byPlan[planName] || 0) + 1;
  }

  // Trialing now
  const now = new Date();
  const trialingNow = rows.filter((v) => {
    const ends = v.directory_trial_ends_at as string | null;
    return ends && new Date(ends) > now;
  }).length;

  // Funnel stage counts
  const stageCounts: Record<string, number> = {};
  for (const s of FUNNEL_STAGES) stageCounts[s.key] = 0;
  for (const v of rows) {
    const reached = venueStageReached(v as VenueFunnelState);
    let highest = 'signed_up';
    for (const s of FUNNEL_STAGES) {
      if (reached[s.key]) highest = s.key;
    }
    stageCounts[highest] = (stageCounts[highest] || 0) + 1;
  }

  return {
    total_venues: rows.length,
    by_subscription_status: byStatus,
    by_plan: byPlan,
    trialing_now: trialingNow,
    funnel_highest_stage: stageCounts,
  };
}

async function toolListVenues(args: { status?: string; limit?: number }) {
  const limit = Math.min(args.limit ?? 20, 100);
  const status = args.status ?? 'all';

  let q = supabaseAdmin
    .from('venues')
    .select(
      'id, name, email, directory_plan_id, directory_subscription_status, ' +
        'directory_trial_ends_at, is_published, created_at, last_login_at, ' +
        'onboarding_last_step, onboarding_completed_at, onboarding_activated_at, ' +
        'directory_subscription_external_id, setup_completed',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status === 'trialing') {
    q = q.eq('directory_subscription_status', 'trialing');
  } else if (status === 'active') {
    q = q.eq('directory_subscription_status', 'active');
  } else if (status === 'free') {
    q = q.is('directory_plan_id', null);
  }

  const [{ data: venues }, { data: plans }] = await Promise.all([
    q,
    supabaseAdmin.from('directory_plans').select('id, name, slug'),
  ]);

  const planById = new Map((plans ?? []).map((p) => [p.id as string, p.name as string]));
  const rows = ((venues ?? []) as unknown as Record<string, unknown>[]).map((v) => {
    const pid = v.directory_plan_id as string | null;
    const reached = venueStageReached(v as VenueFunnelState);
    let funnelStage = 'signed_up';
    for (const s of FUNNEL_STAGES) {
      if (reached[s.key]) funnelStage = s.key;
    }
    return {
      id: v.id,
      name: v.name,
      email: v.email,
      plan: pid ? (planById.get(pid) ?? pid) : null,
      subscription_status: v.directory_subscription_status,
      trial_ends_at: v.directory_trial_ends_at,
      is_published: v.is_published,
      created_at: v.created_at,
      last_login_at: v.last_login_at,
      funnel_stage: funnelStage,
    };
  });

  return { count: rows.length, venues: rows };
}

async function toolGetFunnelStats() {
  const { data: venues } = await supabaseAdmin
    .from('venues')
    .select(
      'id, is_published, onboarding_last_step, onboarding_completed_at, ' +
        'onboarding_activated_at, directory_subscription_status, directory_subscription_external_id',
    );

  const rows = (venues ?? []) as unknown as Record<string, unknown>[];
  const counts: Record<string, number> = {};
  for (const s of FUNNEL_STAGES) counts[s.key] = 0;

  for (const v of rows) {
    const reached = venueStageReached(v as VenueFunnelState);
    for (const s of FUNNEL_STAGES) {
      if (reached[s.key]) counts[s.key] += 1;
    }
  }

  const signedUp = counts['signed_up'] || 1;
  const funnel = FUNNEL_STAGES.map((s, i) => {
    const prev = i > 0 ? counts[FUNNEL_STAGES[i - 1].key] : counts[s.key];
    return {
      key: s.key,
      label: s.label,
      count: counts[s.key],
      pct_of_signups: Math.round((counts[s.key] / signedUp) * 100),
      step_conversion: prev > 0 ? Math.round((counts[s.key] / prev) * 100) : 0,
    };
  });

  return { total_venues: rows.length, funnel };
}

async function toolGetLeadStats(args: { days?: number }) {
  const days = args.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: newLeads, count: newCount }, { data: totalLeads, count: totalCount }] =
    await Promise.all([
      supabaseAdmin
        .from('leads')
        .select('id, venue_id, created_at', { count: 'exact' })
        .gte('created_at', since),
      supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true }),
    ]);

  // Group new leads by venue
  const byVenue: Record<string, number> = {};
  for (const lead of newLeads ?? []) {
    const vid = (lead.venue_id as string) ?? 'unknown';
    byVenue[vid] = (byVenue[vid] || 0) + 1;
  }

  const topVenues = Object.entries(byVenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([venue_id, count]) => ({ venue_id, count }));

  return {
    period_days: days,
    new_leads_in_period: newCount ?? 0,
    total_leads_all_time: totalCount ?? 0,
    top_venues_by_new_leads: topVenues,
  };
}

async function toolGetUnreadConversations(args: { limit?: number }) {
  const limit = Math.min(args.limit ?? 20, 100);

  // Fetch recent threads where last message was from a contact (bride)
  const { data: threads } = await supabaseAdmin
    .from('conversation_threads')
    .select(
      'id, venue_id, venue_customer_id, subject, last_message_at, last_message_preview',
    )
    .order('last_message_at', { ascending: false })
    .limit(limit * 3); // over-fetch to allow filtering

  if (!threads?.length) return { count: 0, conversations: [] };

  // Get the last message sender for each thread to find unread (bride was last)
  const threadIds = threads.map((t) => t.id as string);
  const { data: lastMessages } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id, sender_kind, created_at')
    .in('thread_id', threadIds)
    .order('created_at', { ascending: false });

  // Find last message per thread
  const lastByThread = new Map<string, string>();
  for (const msg of lastMessages ?? []) {
    const tid = msg.thread_id as string;
    if (!lastByThread.has(tid)) lastByThread.set(tid, msg.sender_kind as string);
  }

  // Keep only threads where bride (contact) was last to message
  const unread = threads
    .filter((t) => lastByThread.get(t.id as string) === 'contact')
    .slice(0, limit);

  // Enrich with venue names
  const venueIds = [...new Set(unread.map((t) => t.venue_id as string))];
  const { data: venues } = await supabaseAdmin
    .from('venues')
    .select('id, name')
    .in('id', venueIds);
  const venueNames = new Map((venues ?? []).map((v) => [v.id as string, v.name as string]));

  const conversations = unread.map((t) => ({
    thread_id: t.id,
    venue_id: t.venue_id,
    venue_name: venueNames.get(t.venue_id as string) ?? null,
    subject: t.subject,
    last_message_at: t.last_message_at,
    preview: t.last_message_preview,
  }));

  return { count: conversations.length, conversations };
}

async function toolGetVenueDetail(args: { query: string }) {
  const q = args.query.trim();
  if (!q) throw new Error('query is required');

  // Try UUID match first, then name search
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

  const [{ data: venueRows }, { data: plans }] = await Promise.all([
    isUuid
      ? supabaseAdmin.from('venues').select('*').eq('id', q).limit(1)
      : supabaseAdmin.from('venues').select('*').ilike('name', `%${q}%`).limit(5),
    supabaseAdmin.from('directory_plans').select('id, name, slug'),
  ]);

  if (!venueRows?.length) return { found: false, matches: [] };

  const planById = new Map((plans ?? []).map((p) => [p.id as string, p.name as string]));

  // For each matched venue, fetch lead count
  const enriched = await Promise.all(
    venueRows.map(async (v) => {
      const { count: leadCount } = await supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', v.id as string);

      const pid = v.directory_plan_id as string | null;
      const reached = venueStageReached(v as VenueFunnelState);
      let funnelStage = 'signed_up';
      for (const s of FUNNEL_STAGES) {
        if (reached[s.key]) funnelStage = s.key;
      }

      const now = new Date();
      const trialEnds = v.directory_trial_ends_at as string | null;
      const isTrialing = trialEnds ? new Date(trialEnds) > now : false;

      return {
        id: v.id,
        name: v.name,
        email: v.email,
        plan: pid ? (planById.get(pid) ?? pid) : null,
        subscription_status: v.directory_subscription_status,
        trial_ends_at: trialEnds,
        is_trialing: isTrialing,
        is_published: v.is_published,
        created_at: v.created_at,
        last_login_at: v.last_login_at,
        setup_completed: v.setup_completed,
        funnel_stage: funnelStage,
        lead_count: leadCount ?? 0,
        owner_first_name: v.owner_first_name ?? null,
        owner_last_name: v.owner_last_name ?? null,
        phone: v.phone ?? null,
      };
    }),
  );

  return { found: true, matches: enriched };
}

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_venue_overview':
      return toolGetVenueOverview();
    case 'list_venues':
      return toolListVenues(args as { status?: string; limit?: number });
    case 'get_funnel_stats':
      return toolGetFunnelStats();
    case 'get_lead_stats':
      return toolGetLeadStats(args as { days?: number });
    case 'get_unread_conversations':
      return toolGetUnreadConversations(args as { limit?: number });
    case 'get_venue_detail':
      return toolGetVenueDetail(args as { query: string });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const SERVER_INFO = {
  name: 'StoryVenue Admin',
  version: '1.0.0',
  description: 'Admin tools for the StoryVenue wedding venue SaaS platform',
  capabilities: { tools: {} },
};

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(SERVER_INFO);
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcErr(null, -32700, 'Parse error'), { status: 400 });
  }

  const { id, method, params } = body ?? {};

  try {
    switch (method) {
      case 'initialize':
        return NextResponse.json(
          rpcOk(id, {
            protocolVersion: '2024-11-05',
            serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
            capabilities: SERVER_INFO.capabilities,
          }),
        );

      case 'tools/list':
        return NextResponse.json(rpcOk(id, { tools: TOOLS }));

      case 'tools/call': {
        const toolName = params?.name as string | undefined;
        const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
        if (!toolName) {
          return NextResponse.json(rpcErr(id, -32602, 'Missing tool name'), { status: 400 });
        }
        const result = await callTool(toolName, toolArgs);
        return NextResponse.json(rpcOk(id, textContent(result)));
      }

      case 'notifications/initialized':
        // Ack-only, no response body needed but return empty ok
        return NextResponse.json(rpcOk(id, {}));

      default:
        return NextResponse.json(rpcErr(id, -32601, `Method not found: ${method}`), {
          status: 404,
        });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mcp] tool error:', msg);
    return NextResponse.json(rpcErr(id, -32603, `Internal error: ${msg}`), { status: 500 });
  }
}
