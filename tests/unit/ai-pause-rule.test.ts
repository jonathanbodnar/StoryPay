import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// When the AI Concierge stops following up (owner's rule, Oct 5 2026):
// "The AI should never pause unless the bride replies. If the venue owner
// does outward lead generation questions in AI, they're on the same team."
// Until that day a reply from the venue's inbox, its reply by email, and a
// reply by the StoryVenue Concierge team each paused it ("human takeover").
const SRC = join(__dirname, '..', '..', 'src');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('the AI Concierge only stops for the bride', () => {
  it('nothing the venue side does pauses it: there is no "human takeover" pause anywhere', () => {
    const offenders = sourceFiles(SRC).filter((f) => /pauseAiOnHumanTakeover|human_reply_(inbox|email|concierge|crm_app)|human_takeover/.test(code(readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('the places a venue-side message is sent or brought in never touch the AI\u2019s state', () => {
    for (const file of [
      'app/api/conversations/threads/[threadId]/messages/route.ts', // the venue's inbox
      'lib/conversations-inbound-email.ts',                          // the venue replying by email
      'lib/support/send-as-venue.ts',                                // the Concierge team, for the venue
    ]) {
      expect(code(read(file)), file).not.toMatch(/setLeadAiState|ai-concierge\/state-control/);
    }
    // The text sync runs the AI only for the couple's own texts (its inbound follow-ups).
    const importer = code(read('lib/ghl-sms-conversations.ts'));
    const venueSide = importer.slice(importer.indexOf('async function importVenueSideTexts'));
    expect(venueSide).not.toMatch(/ai-concierge|setLeadAiState|runInboundGhlSmsSideEffects/);
  });

  it('her reply stops it and moves her to Conversations Started', () => {
    const handler = read('lib/ai-concierge/inbound-handler.ts');
    const neutral = handler.slice(handler.indexOf('const NEUTRAL_REPLY_OUTCOME'), handler.indexOf('function deriveOutcomeFromRule'));
    expect(neutral).toMatch(/toState:\s+'paused'/);
    expect(neutral).toMatch(/stage:\s+'conversation_started'/);
  });
});
