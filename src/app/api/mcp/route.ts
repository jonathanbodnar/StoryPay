/**
 * StoryVenue MCP (Model Context Protocol) server for AI agents — Jarvis and the
 * owner's other agents, which reach it through the Claude API's MCP connector.
 *
 *   URL:       https://app.storyvenue.com/api/mcp
 *   Transport: Streamable HTTP — POST a JSON-RPC message, get one JSON reply
 *              (no server-sent stream; GET answers 405 as the spec allows).
 *   Auth:      "Authorization: Bearer <key>", one key per agent
 *              (scripts/mcp-keys.mjs). No key → 401. Fails closed.
 *   Tools:     read-only, compact, paginated — see lib/mcp/tools.ts.
 *              Every call is written to mcp_audit_log.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateMcp, auditMcpCall, type McpCaller } from '@/lib/mcp/auth';
import { AGENT_TOOLS, AgentSqlError, ToolInputError } from '@/lib/mcp/tools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SERVER_INFO = { name: 'storyvenue', title: 'StoryVenue', version: '2.0.0' };

// Newest first; the client's version is echoed when we support it.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `StoryVenue is a SaaS for wedding venues. You are answering the owner of StoryVenue about their business.

Vocabulary:
- Account = a venue: a StoryVenue customer (table venues). Owners and team members log in to it.
- Paying = subscription status "active". Not paying = every other status: trialing (signed up; may have no card yet), past_due (a payment failed), canceled, or none.
- MRR = plan price + add-ons for paying accounts. Money in the database is in cents (*_cents); tools report dollars (usd).
- Lead = a couple's wedding inquiry to a venue (table leads). Sources: directory (StoryVenue listing), lead_link, embed (venue website form), form (a form the venue built, incl. Meta ad forms), leadfinder (read from a wedding-directory email by Lead Finder), manual, api.
- Demo venues are test accounts and are excluded unless you ask for them.

How to answer:
- Big picture → business_snapshot. Money → revenue_report. Who is paying / not paying → list_accounts with billing_status. One account → get_account. People → list_people. Leads → search_leads / lead_stats.
- Anything else → list_tables, describe_table, then run_sql (read-only; aggregate in SQL).
- Lists are paginated: pass next_offset to get more. Timestamps are UTC.`;

type Json = Record<string, unknown>;

function rpcResult(id: unknown, result: unknown): Json {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: unknown, code: number, message: string): Json {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
}

async function callTool(caller: McpCaller, id: unknown, params: Json): Promise<Json> {
  const name = typeof params.name === 'string' ? params.name : '';
  const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json;
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);

  const started = Date.now();
  try {
    const out = await tool.run(args);
    const text = JSON.stringify(out);
    auditMcpCall({ keyName: caller.name, tool: name, args, ok: true, durationMs: Date.now() - started, resultBytes: text.length });
    return rpcResult(id, { content: [{ type: 'text', text }], isError: false });
  } catch (err) {
    const known = err instanceof ToolInputError || err instanceof AgentSqlError;
    const message = err instanceof Error ? err.message : String(err);
    auditMcpCall({ keyName: caller.name, tool: name, args, ok: false, error: message, durationMs: Date.now() - started });
    if (!known) console.error('[mcp] tool failed:', name, message);
    // A tool error goes back as a result the model can read and recover from.
    return rpcResult(id, {
      content: [{ type: 'text', text: known ? message : `The ${name} tool failed: ${message}` }],
      isError: true,
    });
  }
}

/** One JSON-RPC message → its reply, or null for a notification. */
async function handleMessage(caller: McpCaller, msg: Json): Promise<Json | null> {
  const id = msg.id;
  const isNotification = id === undefined || id === null;
  const method = typeof msg.method === 'string' ? msg.method : '';
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Json;

  if (msg.jsonrpc !== '2.0' || !method) {
    return isNotification ? null : rpcError(id, -32600, 'Invalid request');
  }
  if (isNotification) return null; // notifications/initialized, cancelled, …

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: AGENT_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        })),
      });
    case 'tools/call':
      return callTool(caller, id, params);
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json(rpcError(null, -32001, 'Unauthorized'), {
    status: 401,
    headers: { 'WWW-Authenticate': 'Bearer realm="storyvenue-mcp"' },
  });
}

export async function POST(req: NextRequest) {
  const caller = await authenticateMcp(req.headers.get('authorization'));
  if (!caller) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  // Older clients may send a batch (an array); answer it as one.
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleMessage(caller, (m ?? {}) as Json)))).filter(Boolean);
    return replies.length ? NextResponse.json(replies) : new NextResponse(null, { status: 202 });
  }
  const reply = await handleMessage(caller, (body ?? {}) as Json);
  if (!reply) return new NextResponse(null, { status: 202 });

  const res = NextResponse.json(reply);
  if ((body as Json).method === 'initialize') {
    res.headers.set('MCP-Protocol-Version', String(((reply.result ?? {}) as Json).protocolVersion ?? ''));
  }
  return res;
}

/** No server-initiated stream: the spec allows 405 here. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

/** Stateless server: there is no session to end. */
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
