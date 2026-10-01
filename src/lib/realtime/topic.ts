/**
 * Secret Realtime topic names. SERVER-ONLY.
 *
 * Live updates go out on Supabase Realtime broadcast channels, which anyone
 * holding the public anon key can join by name. So the name itself is the
 * secret: each logical channel ("venue:<id>:leads", "support:bride-inbox", …,
 * see channels.ts) maps to an HMAC of that name. The server broadcasts only on
 * the secret names, and a browser learns a secret name only from
 * /api/realtime/topics, which checks the caller is allowed that channel.
 */

import crypto from 'crypto';

let derivedKey: Buffer | null = null;

function topicKey(): Buffer {
  if (derivedKey) return derivedKey;
  const base =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ADMIN_SECRET;
  if (!base) throw new Error('[realtime] no server secret available to derive topic names');
  derivedKey = crypto.createHmac('sha256', base).update('storyvenue-realtime-topic-v1').digest();
  return derivedKey;
}

/** The secret topic for a logical channel name. */
export function realtimeTopic(logicalName: string): string {
  return 'sv:' + crypto.createHmac('sha256', topicKey()).update(logicalName).digest('base64url').slice(0, 32);
}

const ID = '[A-Za-z0-9-]{1,64}';
const ADMIN_PATTERNS = [
  /^support:(bride-inbox|tickets|venue-direct-inbox|private-clients|venue-concierge-inbox)$/,
  new RegExp(`^support:(thread|ticket):${ID}$`),
  /^admin:error-feed$/,
  new RegExp(`^presence:(thread|ticket):${ID}$`),
  new RegExp(`^venue:${ID}:(tickets|leads|visitor-map|conversations|concierge)$`),
  new RegExp(`^venue:${ID}:(ticket|thread):${ID}$`),
];

/**
 * May this caller listen on this logical channel? Admins and support agents
 * may listen anywhere; a venue session only inside its own venue's channels.
 */
export function topicAllowed(logicalName: string, caller: { admin: boolean; venueId: string | null }): boolean {
  if (logicalName.length > 200) return false;
  if (caller.admin) return ADMIN_PATTERNS.some((re) => re.test(logicalName));
  if (!caller.venueId) return false;
  const prefix = `venue:${caller.venueId}:`;
  if (!logicalName.startsWith(prefix)) return false;
  const rest = logicalName.slice(prefix.length);
  return (
    /^(tickets|leads|visitor-map|conversations|concierge)$/.test(rest) ||
    new RegExp(`^(ticket|thread):${ID}$`).test(rest)
  );
}
