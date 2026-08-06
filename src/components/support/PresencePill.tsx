'use client';

import { Eye } from 'lucide-react';
import type { PresentAgent } from '@/lib/realtime/use-thread-presence';
import { AgentAvatar } from '@/components/support/AgentAvatar';

/** Small "Francine is viewing this" pill shown near the composer. */
export function PresencePill({ agents }: { agents: PresentAgent[] }) {
  if (agents.length === 0) return null;
  const [first, ...rest] = agents;
  const label = rest.length === 0
    ? `${first.agentName} is viewing this`
    : `${first.agentName} +${rest.length} others viewing`;

  return (
    <span
      title={agents.map(a => a.agentName).join(', ')}
      className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700"
    >
      <Eye size={11} />
      <span className="flex -space-x-1">
        {agents.slice(0, 3).map(a => (
          <AgentAvatar key={a.agentId} id={a.agentId} name={a.agentName} size="xs" className="ring-2 ring-blue-50" />
        ))}
      </span>
      {label}
    </span>
  );
}
