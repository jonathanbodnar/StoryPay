/**
 * StoryVenue LeadFinder™ — turning an inbound email into lead fields.
 *
 * SECURITY: the input is untrusted. This module is deliberately pure and
 * powerless: it reads text and returns a fixed set of typed fields. It cannot
 * send, write, fetch, or call anything, so text inside an email can never
 * command the system no matter what it says.
 *
 * The first pass is DETERMINISTIC and label-driven, because that is how nearly
 * every marketplace notification is shaped ("Name: …", "Email: …",
 * "Guest Count: …"). It costs nothing, is exact, and is easy to test. Anything
 * it cannot read well enough is left for the AI fallback rather than guessed at.
 *
 * Nothing here is marketplace-specific. Per-source parsers come later, once real
 * templates are available, and slot in ahead of this without changing it.
 */

export interface ExtractedLead {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  weddingDate: string | null;
  guestCount: number | null;
  venueMatters: string | null;
  timeline: string | null;
  message: string | null;
  /** Which fields we found — drives the confidence score. */
  found: string[];
}

export interface ExtractInput {
  subject: string | null;
  text: string;
  /** Display name from the From/Reply-To header, a decent fallback for a name. */
  senderName?: string | null;
}

// ── Sender classification ────────────────────────────────────────────────────

/**
 * Known wedding marketplaces. Used to label the lead's source, never to grant
 * trust: a message from one of these domains is only a lead if its content
 * looks like an inquiry (see isLikelyNotLead).
 */
const SOURCE_BY_DOMAIN: Array<{ match: RegExp; label: string }> = [
  { match: /(^|\.)theknot\.com$/i,             label: 'The Knot' },
  { match: /(^|\.)weddingwire\.com$/i,         label: 'WeddingWire' },
  { match: /(^|\.)weddingpro\.com$/i,          label: 'WeddingPro' },
  { match: /(^|\.)zola\.com$/i,                label: 'Zola' },
  { match: /(^|\.)partyslate\.com$/i,          label: 'PartySlate' },
  { match: /(^|\.)wedding-spot\.com$/i,        label: 'Wedding Spot' },
  { match: /(^|\.)herecomestheguide\.com$/i,   label: 'Here Comes The Guide' },
  { match: /(^|\.)eventective\.com$/i,         label: 'Eventective' },
];

export function domainOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = /@([^>\s]+)/.exec(address);
  return m ? m[1].toLowerCase().replace(/[.,;]+$/, '') : null;
}

/** Human label for a sender domain, or null when it is not a known marketplace. */
export function sourceForDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  for (const s of SOURCE_BY_DOMAIN) if (s.match.test(domain)) return s.label;
  return null;
}

/**
 * Subjects that look like a notification ABOUT the account rather than an
 * inquiry. Kept deliberately narrow — a false negative here means a lost lead,
 * so it only rejects things that are clearly not enquiries.
 */
const NOT_LEAD_SUBJECT = /\b(invoice|receipt|your (monthly )?statement|payment (has been )?received|your listing is (now )?live|subscription (renewed|renewal)|billing|unsubscribe|password|verify your email|review request|leave a review|newsletter|weekly (digest|roundup)|tips for vendors?)\b/i;

export function isLikelyNotLead(subject: string | null | undefined): boolean {
  return !!subject && NOT_LEAD_SUBJECT.test(subject);
}

// ── Field extraction ─────────────────────────────────────────────────────────

/** Label synonyms, matched case-insensitively at the start of a line. */
const LABELS: Array<{ field: keyof ExtractedLead | 'message' | 'wants'; keys: string[] }> = [
  { field: 'name',        keys: ['full name', 'bride name', 'couple name', 'contact name', 'name'] },
  { field: 'email',       keys: ['email address', 'e-mail address', 'email', 'e-mail'] },
  { field: 'phone',       keys: ['phone number', 'mobile number', 'cell phone', 'telephone', 'phone', 'mobile', 'cell'] },
  { field: 'guestCount',  keys: ['guest count', 'estimated guests', 'number of guests', 'guest number', 'guests', 'party size'] },
  { field: 'weddingDate', keys: ['wedding date', 'event date', 'preferred date', 'date of wedding', 'date'] },
  { field: 'wants',       keys: ['what they want most in a venue', 'what matters most', 'must haves', 'must-haves', 'looking for', 'requirements', 'venue matters', 'wants'] },
  { field: 'timeline',    keys: ['booking timeline', 'planning timeline', 'when are you looking', 'timeline', 'when'] },
  { field: 'message',     keys: ['additional information', 'additional details', 'comments', 'inquiry message', 'message', 'notes', 'question'] },
];

/** Strip a leading quote/bullet decoration from a captured value. */
function cleanValue(v: string): string {
  return v
    .replace(/^[\s:•\-–—*]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read labelled lines into a plain string map. Values may wrap onto the
 * following line(s) until the next label, which matters because marketplace
 * HTML often reflows into one line per field and long answers span several.
 */
function readLabelledFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Label: value" or "Label value" (marketplace templates do both).
    const m = /^([A-Za-z][A-Za-z0-9 /'’\-]{1,40}?)\s*[:\-]\s*(.*)$/.exec(line);
    if (!m) continue;
    const label = m[1].toLowerCase().trim();
    const entry = LABELS.find((L) => L.keys.includes(label));
    if (!entry) continue;

    let value = cleanValue(m[2]);
    // Absorb wrapped continuation lines until the next labelled line.
    for (let j = i + 1; j < lines.length && value.length < 1200; j++) {
      if (/^[A-Za-z][A-Za-z0-9 /'’\-]{1,40}?\s*[:\-]/.test(lines[j])) break;
      if (LABELS.some((L) => L.keys.includes(lines[j].toLowerCase().trim()))) break;
      value = `${value} ${lines[j]}`.replace(/\s+/g, ' ').trim();
      i = j;
    }
    if (value && !out[entry.field]) out[entry.field] = value;
  }
  return out;
}

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
/** US-style phone: 10+ digits with optional formatting. Deliberately loose. */
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/** Normalise to E.164-ish digits, or null when it is not a usable number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

/** Parse a date out of free text into YYYY-MM-DD, or null. */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  // ISO first.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // "June 14, 2027" / "14 June 2027" / "6/14/2027".
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    // Reject obvious nonsense from Date's lenient parsing.
    if (y >= new Date().getFullYear() - 1 && y <= new Date().getFullYear() + 8) {
      return `${y}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
  }
  return null;
}

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** "New wedding inquiry from Sarah Johnson" → "Sarah Johnson". */
function nameFromSubject(subject: string | null): string | null {
  if (!subject) return null;
  const m = /\b(?:from|for|new (?:lead|inquiry|message)\s*[:\-]?)\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3})/.exec(subject);
  const candidate = m?.[1]?.trim();
  if (!candidate) return null;
  // Don't mistake a venue name or boilerplate for a person.
  if (/\b(venue|wedding|inquiry|lead|the knot|weddingwire|zola)\b/i.test(candidate)) return null;
  return candidate;
}

/**
 * Extract what we can. Returns only what was actually found — callers decide
 * what constitutes "enough" to create a lead.
 */
export function extractLeadFromEmail(input: ExtractInput): ExtractedLead {
  const text = input.text ?? '';
  const labelled = readLabelledFields(text);

  const email = (labelled.email && EMAIL_RE.exec(labelled.email)?.[0])
    || EMAIL_RE.exec(text)?.[0]
    || null;

  const phone = normalizePhone(labelled.phone) || normalizePhone(PHONE_RE.exec(text)?.[0] || null);

  const rawName = (labelled.name || '').trim() || nameFromSubject(input.subject) || (input.senderName || '').trim();
  // A "name" that contains an email address or is absurdly long is not a name.
  const usableName = rawName && !EMAIL_RE.test(rawName) && rawName.length <= 120 ? rawName : '';
  const { first, last } = usableName ? splitName(usableName) : { first: null, last: null };

  const guestCountRaw = labelled.guestCount ?? '';
  const guestCountNum = guestCountRaw ? Number((/(\d{1,5})/.exec(guestCountRaw) || [])[1]) : NaN;

  const result: ExtractedLead = {
    name: usableName || null,
    firstName: first,
    lastName: last,
    email,
    phone,
    weddingDate: normalizeDate(labelled.weddingDate),
    guestCount: Number.isFinite(guestCountNum) ? guestCountNum : null,
    venueMatters: labelled.wants ? cleanValue(labelled.wants).slice(0, 2000) : null,
    timeline: labelled.timeline ? cleanValue(labelled.timeline).slice(0, 200) : null,
    message: labelled.message ? cleanValue(labelled.message).slice(0, 4000) : null,
    found: [],
  };

  result.found = (['name', 'email', 'phone', 'weddingDate', 'guestCount', 'venueMatters', 'timeline', 'message'] as const)
    .filter((k) => result[k] !== null && result[k] !== undefined);

  return result;
}

export interface Classification {
  /** Whether this message should become a lead at all. */
  accept: boolean;
  reason: string | null;
  detectedSource: string | null;
  /** 0–1. High confidence creates automatically; the score is stored either way. */
  confidence: number;
}

/**
 * Decide whether a message is an inquiry, and how sure we are.
 *
 * Deliberately biased toward keeping a message: a false positive costs an
 * ignorable lead, a false negative loses a couple. Only subjects that are
 * clearly account notifications are rejected outright.
 */
export function classifyInbound(args: {
  subject: string | null;
  senderDomain: string | null;
  extracted: ExtractedLead;
}): Classification {
  const detectedSource = sourceForDomain(args.senderDomain);

  if (isLikelyNotLead(args.subject)) {
    return { accept: false, reason: 'not_an_inquiry_subject', detectedSource, confidence: 0 };
  }

  // `leads.email` is NOT NULL with no database default, so a message we cannot
  // reply to by email cannot become a lead. Rejected rows are still recorded
  // with a reason rather than dropped, so a phone-only arrival stays visible.
  if (!args.extracted.email) {
    return { accept: false, reason: 'no_email_address', detectedSource, confidence: 0 };
  }

  let score = 0.5;                                   // has a usable identity
  if (detectedSource) score += 0.25;                 // known marketplace shape
  if (args.extracted.phone) score += 0.05;
  if (args.extracted.name) score += 0.1;
  if (args.extracted.guestCount !== null) score += 0.05;
  if (args.extracted.weddingDate) score += 0.05;
  if (args.extracted.venueMatters) score += 0.05;

  return { accept: true, reason: null, detectedSource, confidence: Math.min(1, Number(score.toFixed(2))) };
}
