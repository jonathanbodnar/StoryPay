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
 * Three things it must never do, because each one produces a lead that looks
 * real and is wrong:
 *
 *   1. Mistake the VENUE for the couple. A forwarded email carries the owner's
 *      name, address, phone and signature above the original; a website form
 *      notification comes from the venue's own domain. The venue's identity is
 *      passed in and never read back as the couple's.
 *   2. Mistake the MARKETPLACE for the couple. "The Knot" is a sender display
 *      name, not a person; a support number in a footer is not the couple's
 *      phone; digits inside a tracking link are not a phone at all.
 *   3. Invent precision. "Spring 2027" is not 2027-01-01, and a bare year is not
 *      a date. An answer it cannot read exactly is left empty.
 *
 * Nothing here is marketplace-specific, so per-source parsers can slot in
 * ahead of it later without changing it.
 */

export type EmailSource = 'labelled' | 'forwarded_sender' | 'reply_to' | 'sender' | 'body';

export interface ForwardedHeaders {
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  date: string | null;
}

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
  /** Where the email address came from, which is how far it can be trusted. */
  emailSource: EmailSource | null;
  /**
   * The address is a marketplace relay (replies route through the marketplace's
   * own inbox), not the couple's personal address.
   */
  emailIsRelay: boolean;
  /**
   * The phone was read from a labelled field rather than spotted in free text.
   * Only a labelled phone is trusted enough to match an existing lead by.
   */
  phoneLabelled: boolean;
  /** Set when this arrival is a forward; the headers of the ORIGINAL message. */
  forwarded: ForwardedHeaders | null;
  /**
   * An address that WAS in the message (labelled, or in the inquiry text) but
   * belongs to the venue itself — its account, notification or team email — so
   * it was not used as the couple's. Lets a skip say exactly why.
   */
  ignoredVenueEmail: string | null;
  /** The part of the email that holds the inquiry (the original, for a forward). */
  inquiryText: string;
}

/**
 * Who the venue is, so its own name, addresses and numbers are never read back
 * as the couple's. Every list is optional and may contain blanks.
 */
export interface VenueIdentity {
  name?: string | null;
  emails?: Array<string | null | undefined>;
  phones?: Array<string | null | undefined>;
  /** Domains that belong to the venue or to us — never a couple's. */
  domains?: Array<string | null | undefined>;
}

export interface ExtractInput {
  subject: string | null;
  text: string;
  /** Display name from the From header. */
  senderName?: string | null;
  /** Bare address from the From header. */
  senderEmail?: string | null;
  /** The Reply-To header, raw (`"Name" <addr>` or `addr`). */
  replyTo?: string | null;
  venue?: VenueIdentity;
}

// ── Sender classification ────────────────────────────────────────────────────

/**
 * Known wedding marketplaces. Used to label the lead's source, never to grant
 * trust: a message from one of these domains is only a lead if its content
 * looks like an inquiry.
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
  return m ? m[1].toLowerCase().replace(/[.,;>)\]]+$/, '') : null;
}

/** Human label for a sender domain, or null when it is not a known marketplace. */
export function sourceForDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  for (const s of SOURCE_BY_DOMAIN) if (s.match.test(domain)) return s.label;
  return null;
}

/**
 * Subjects that look like a notification ABOUT the account, a bounce, or an
 * auto-reply rather than an inquiry. Kept deliberately narrow — a false
 * negative here means a lost lead, so it only rejects things that are clearly
 * not enquiries.
 */
const NOT_LEAD_SUBJECT = new RegExp(
  '\\b(' + [
    'invoice', 'receipt', 'your (monthly )?statement', 'payment (has been )?received',
    'your listing is (now )?live', 'subscription (renewed|renewal)', 'billing', 'unsubscribe',
    'password', 'verify your email', 'review request', 'leave a review', 'newsletter',
    'weekly (digest|roundup)', 'tips for vendors?', 'forwarding confirmation',
    'delivery status notification', 'undeliverable', 'undelivered mail',
    'mail delivery (failed|subsystem)', 'returned mail', 'failure notice',
    'automatic reply', 'auto-?reply', 'autoreply', 'out of (the )?office',
  ].join('|') + ')\\b',
  'i',
);

export function isLikelyNotLead(subject: string | null | undefined): boolean {
  return !!subject && NOT_LEAD_SUBJECT.test(subject);
}

/** Bounce and system senders — never a couple, whatever the subject says. */
const SYSTEM_SENDER_LOCAL = /^(mailer-daemon|postmaster|bounces?|bounce-[\w.-]+|no-?reply|do-?not-?reply|donotreply|noreply[\w.-]*)$/i;

/**
 * Role mailboxes that appear in marketplace footers and signatures. Never a
 * couple when spotted in free text (a couple writing to us directly is
 * identified by the From header instead).
 */
const ROLE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|noreply[\w.-]*|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|automated|auto-?confirm|system|support|help|info|hello|team|news(letter)?|marketing|messages?|privacy|legal|billing|sales|press|feedback|service|customerservice|care)$/i;

function localPart(addr: string): string {
  return (addr.split('@')[0] ?? '').toLowerCase();
}

export function isSystemSender(address: string | null | undefined): boolean {
  if (!address) return false;
  return SYSTEM_SENDER_LOCAL.test(localPart(address).split('+')[0]);
}

// ── Small text helpers ───────────────────────────────────────────────────────

const EMAIL_SRC = "[a-z0-9._%+'-]+@[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}";

function emailsIn(s: string | null | undefined): string[] {
  if (!s) return [];
  return [...s.matchAll(new RegExp(EMAIL_SRC, 'gi'))].map((m) => m[0].toLowerCase().replace(/^['.]+|['.]+$/g, ''));
}

/** `"Sarah Jones" <sarah@x.com>` → { email: 'sarah@x.com', name: 'Sarah Jones' }. */
export function parseAddressHeader(raw: string | null | undefined): { email: string | null; name: string | null } {
  return { email: emailsIn(raw)[0] ?? null, name: displayNameOf(raw) };
}

/** Display name out of `"Sarah Jones" <sarah@x.com>` / `Sarah via The Knot <…>`. */
function displayNameOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lt = raw.indexOf('<');
  const name = (lt > 0 ? raw.slice(0, lt) : '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+via\s+.+$/i, '')
    .trim();
  return name || null;
}

function cleanValue(v: string): string {
  return v
    .replace(/^[\s:•\-–—*]+/, '')
    .replace(/[*]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise an address for identity comparison: no +tag, no Gmail dots. */
function canonicalEmail(addr: string): string {
  const [rawLocal, rawDomain] = addr.toLowerCase().trim().split('@');
  if (!rawLocal || !rawDomain) return addr.toLowerCase().trim();
  let local = rawLocal.split('+')[0];
  if (rawDomain === 'gmail.com' || rawDomain === 'googlemail.com') local = local.replace(/\./g, '');
  return `${local}@${rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain}`;
}

const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'comcast.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'verizon.net', 'cox.net',
  'charter.net', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
  'yahoo.co.uk', 'hotmail.co.uk', 'btinternet.com',
]);

export function isFreemailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREEMAIL.has(domain.toLowerCase());
}

// ── Venue identity ───────────────────────────────────────────────────────────

interface Identity {
  emails: Set<string>;
  domains: Set<string>;
  phones: Set<string>;
  name: string | null;
}

function buildIdentity(v: VenueIdentity | undefined): Identity {
  const emails = new Set<string>();
  const domains = new Set<string>();
  const phones = new Set<string>();
  for (const e of v?.emails ?? []) {
    for (const addr of emailsIn(e)) {
      emails.add(canonicalEmail(addr));
      const d = domainOf(addr);
      // A venue on its own domain owns every address on it; a venue on Gmail
      // owns only its own address.
      if (d && !isFreemailDomain(d)) domains.add(d);
    }
  }
  for (const d of v?.domains ?? []) {
    const clean = (d ?? '').toLowerCase().trim().replace(/^www\./, '');
    if (clean && !isFreemailDomain(clean)) domains.add(clean);
  }
  for (const p of v?.phones ?? []) {
    const digits = (p ?? '').replace(/\D/g, '');
    if (digits.length >= 10) phones.add(digits.slice(-10));
  }
  const name = (v?.name ?? '').trim().toLowerCase() || null;
  return { emails, domains, phones, name };
}

function isVenueAddress(addr: string, id: Identity): boolean {
  if (id.emails.has(canonicalEmail(addr))) return true;
  const d = domainOf(addr);
  if (!d) return false;
  for (const own of id.domains) if (d === own || d.endsWith(`.${own}`)) return true;
  return false;
}

function isVenuePhone(e164: string, id: Identity): boolean {
  return id.phones.has(e164.replace(/\D/g, '').slice(-10));
}

// ── Body structure ───────────────────────────────────────────────────────────

/** Where the couple's own words end: a signature, a quoted reply, a device tag. */
function isSignatureOrQuoteStart(line: string): boolean {
  const t = line.trim();
  if (/^--\s*$/.test(t)) return true;                         // RFC 3676 signature delimiter
  if (/^_{5,}$/.test(t)) return true;
  if (/^-{5,}$/.test(t)) return true;
  if (/^on .{3,120} wrote:$/i.test(t)) return true;            // quoted reply
  if (/^sent from my \w+/i.test(t)) return true;
  if (/\bunsubscribe\b/i.test(t)) return true;
  return false;
}

/**
 * Lines that end a wrapped answer. Without this, the "absorb continuation lines"
 * behaviour swallows whatever follows the last labelled field — which is almost
 * always an email signature.
 */
function isBodyBoundary(line: string): boolean {
  const t = line.trim();
  if (isSignatureOrQuoteStart(t)) return true;
  if (/^\*?(from|sent|to|cc|subject)\*?:\s*\S/i.test(t)) return true; // a mail header line
  if (FORWARD_MARKERS.some((re) => re.test(t))) return true;
  return false;
}

/** Any "Label: value" line, known field or not — the end of the previous answer. */
function looksLikeLabelLine(line: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 #/&'’.()-]{0,38}:(\s|$)/.test(line.trim());
}

/** A quoted mail header BLOCK (From: followed by Sent:/Date:/To:/Subject:), not a lone field. */
function isHeaderBlockAt(lines: string[], i: number): boolean {
  if (!/^\*?from\*?\s*:/i.test(stripQuote(lines[i] ?? '').trim())) return false;
  for (let k = i + 1; k <= i + 3 && k < lines.length; k++) {
    if (/^\*?(sent|date|to|subject)\*?\s*:/i.test(stripQuote(lines[k]).trim())) return true;
  }
  return false;
}

/** Marketplace chrome that follows the inquiry: calls to action, legal footers. */
const FOOTER_RE = new RegExp(
  '(©|\\ball rights reserved\\b|\\bprivacy policy\\b|\\bterms (of (use|service)|and conditions)\\b' +
  '|\\bview (this email )?in (your |a )?browser\\b|\\bdownload (the|our) app\\b|\\bapp store\\b|\\bgoogle play\\b' +
  '|\\byou(\'re| are)? receiv(ing|ed) this\\b|\\bthis (e-?mail|message) was sent\\b' +
  '|\\bmanage (your )?(e-?mail |notification )?(preferences|settings)\\b|\\bnotification settings\\b' +
  '|\\blog ?in to (your|reply|respond|view)\\b|\\b(reply|respond) (on|in|via|through) (the knot|weddingwire|zola|your|our)\\b' +
  '|\\bclick here\\b|\\bview (the )?(full )?(message|lead|inquiry|request|conversation)\\b)',
  'i',
);

/** A line that is nothing but a link (optionally "Label (https://…)"). */
const URL_LINE_RE = /^[^:]{0,60}\(?\s*https?:\/\/\S+\s*\)?$/i;

function isChrome(line: string): boolean {
  const t = line.trim();
  return URL_LINE_RE.test(t) || FOOTER_RE.test(t);
}

/** The inquiry up to its signature / quoted reply / footer, for free-text use. */
function bodyUntilBoundary(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = stripQuote(lines[i]).trim();
    if (isSignatureOrQuoteStart(t) || FOOTER_RE.test(t) || isHeaderBlockAt(lines, i)) break;
    if (FORWARD_MARKERS.some((re) => re.test(t))) break;
    out.push(lines[i]);
  }
  return out;
}

// ── Forwarded messages ───────────────────────────────────────────────────────

const FORWARD_MARKERS: RegExp[] = [
  /^-{2,}\s*forwarded message\s*-{2,}$/i,   // Gmail
  /^begin forwarded message:?$/i,             // Apple Mail
  /^-{2,}\s*original message\s*-{2,}$/i,    // Outlook (classic)
  /^-{2,}\s*forwarded by .{1,80}-{2,}$/i,
  /^_{10,}$/,                                  // Outlook's rule line — only when a header block follows
];

const FWD_HEADER_RE = /^\*?(from|sent|date|to|cc|bcc|subject|reply-to)\*?\s*:\s*\*?\s*(.*)$/i;

function stripQuote(line: string): string {
  return line.replace(/^(>\s?)+/, '');
}

interface ForwardSplit {
  headers: ForwardedHeaders;
  body: string[];
}

/** Parse the header block that starts at `start`; null unless it has a From: line. */
function readForwardHeaderBlock(lines: string[], start: number): { headers: ForwardedHeaders; end: number } | null {
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;
  const headers: ForwardedHeaders = { fromEmail: null, fromName: null, subject: null, date: null };
  let sawFrom = false;
  let count = 0;
  for (; i < lines.length; i++) {
    const t = stripQuote(lines[i]).trim();
    if (!t) break;
    const m = FWD_HEADER_RE.exec(t);
    if (!m) break;
    count++;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'from') {
      sawFrom = true;
      headers.fromEmail = emailsIn(value)[0] ?? null;
      headers.fromName = displayNameOf(value.replace(/\[mailto:[^\]]*\]/i, '').replace(/<mailto:/i, '<'))
        ?? (headers.fromEmail ? null : value.replace(/^["']|["']$/g, '').trim() || null);
    } else if (key === 'subject') {
      headers.subject = value || null;
    } else if (key === 'date' || key === 'sent') {
      headers.date = value || null;
    }
  }
  if (!sawFrom || count < 2) return null;
  return { headers, end: i };
}

/**
 * Find the ORIGINAL message inside a forward. The first forwarded block whose
 * sender is not the venue itself wins, so a forward of a forward inside the
 * venue's own team still resolves to the couple's (or marketplace's) email.
 */
function splitForwarded(lines: string[], id: Identity): ForwardSplit | null {
  const found: Array<{ headers: ForwardedHeaders; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const t = stripQuote(lines[i]).trim();
    const isMarker = FORWARD_MARKERS.some((re) => re.test(t));
    // Outlook without a separator: a From: line directly followed by Sent:/Date:.
    const bareHeader = !isMarker && /^\*?from\*?\s*:/i.test(t) && i + 1 < lines.length
      && /^\*?(sent|date)\*?\s*:/i.test(stripQuote(lines[i + 1]).trim());
    if (!isMarker && !bareHeader) continue;
    const block = readForwardHeaderBlock(lines, isMarker ? i + 1 : i);
    if (block) {
      found.push(block);
      i = block.end;
    }
  }
  if (found.length === 0) return null;
  const pick = found.find((f) => !f.headers.fromEmail || !isVenueAddress(f.headers.fromEmail, id)) ?? found[found.length - 1];
  return { headers: pick.headers, body: lines.slice(pick.end).map(stripQuote) };
}

// ── Labelled fields ──────────────────────────────────────────────────────────

type FieldKey =
  | 'name' | 'firstName' | 'lastName' | 'email' | 'phone'
  | 'guestCount' | 'weddingDate' | 'wants' | 'timeline' | 'message';

const LABEL_SYNONYMS: Record<FieldKey, string[]> = {
  name: [
    'name', 'full name', 'your name', 'contact name', 'contact', 'client name', 'customer name',
    'bride name', "bride's name", 'bride', 'groom name', "groom's name", 'couple', 'couple name',
    'couple names', "couple's name", "couple's names", 'names', 'partner names', 'lead name', 'inquirer',
  ],
  firstName: ['first name', 'your first name', 'given name', "bride's first name"],
  lastName: ['last name', 'your last name', 'surname', 'family name'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'your email', 'contact email', 'email id'],
  phone: [
    'phone', 'phone number', 'phone #', 'phone no', 'phone no.', 'mobile', 'mobile number', 'mobile phone',
    'cell', 'cell phone', 'cell number', 'telephone', 'tel', 'contact number', 'contact phone',
    'best phone', 'your phone', 'best number',
  ],
  guestCount: [
    'guests', 'guest count', 'number of guests', 'no. of guests', '# of guests', 'estimated guests',
    'estimated guest count', 'guest count estimate', 'approximate guest count', 'approx. guest count',
    'approx guest count', 'approx. guests', 'expected guests', 'expected guest count', 'guest number',
    'party size', 'headcount', 'head count', 'attendees', 'number of attendees', 'expected attendance',
  ],
  weddingDate: [
    'wedding date', 'event date', 'date', 'preferred date', 'desired date', 'date of wedding',
    'date of event', 'wedding day', 'target date', 'ceremony date', 'celebration date', 'proposed date',
  ],
  wants: [
    'what they want most in a venue', 'what matters most', 'what matters most to you', 'most important',
    'must haves', 'must-haves', 'looking for', 'what are you looking for', 'requirements', 'venue matters',
    'wants', 'priorities',
  ],
  timeline: [
    'booking timeline', 'planning timeline', 'timeline', 'when are you looking to book', 'when are you looking',
    'when do you plan to book', 'planning stage', 'when',
  ],
  message: [
    'message', 'comments', 'comment', 'additional information', 'additional info', 'additional details',
    'additional comments', 'notes', 'note', 'question', 'questions', 'inquiry', 'inquiry message',
    'your message', 'details', 'tell us about your event', 'tell us about your wedding',
    "couple's message", 'message from couple', 'message from the couple', 'what else should we know',
    'anything else',
  ],
};

const LABEL_INDEX = new Map<string, FieldKey>();
for (const [field, keys] of Object.entries(LABEL_SYNONYMS) as Array<[FieldKey, string[]]>) {
  for (const k of keys) LABEL_INDEX.set(k, field);
}

/** Fields whose answers can run over several lines. The rest are one line. */
const MULTILINE = new Set<FieldKey>(['wants', 'timeline', 'message']);

function normLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[*?]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchLabelLine(line: string): { field: FieldKey; value: string } | null {
  const t = line.trim();
  if (!t) return null;
  // 1. "Label: value" — split on the FIRST colon, so "E-mail:" and "Must-haves:"
  //    read whole instead of being cut at their hyphen.
  const colon = t.indexOf(':');
  if (colon > 0 && colon <= 48) {
    const field = LABEL_INDEX.get(normLabel(t.slice(0, colon)));
    if (field) return { field, value: t.slice(colon + 1) };
  }
  // 2. "Label - value" with a SPACED dash only, so hyphenated words stay intact.
  const dash = /^(.{1,48}?)\s+[-–—]\s+(.*)$/.exec(t);
  if (dash) {
    const field = LABEL_INDEX.get(normLabel(dash[1]));
    if (field) return { field, value: dash[2] };
  }
  // 3. A bare label on its own line; its value is on the next line.
  const bare = LABEL_INDEX.get(normLabel(t.replace(/:$/, '')));
  if (bare) return { field: bare, value: '' };
  return null;
}

function readLabelledFields(lines: string[]): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  for (let i = 0; i < lines.length; i++) {
    const hit = matchLabelLine(lines[i]);
    if (!hit) continue;
    let value = cleanValue(hit.value);
    let j = i + 1;

    // Bare label: take the next non-empty line, unless it is itself a label.
    if (!value) {
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && !matchLabelLine(lines[j]) && !isBodyBoundary(lines[j]) && !isChrome(lines[j])) {
        value = cleanValue(lines[j]);
        j++;
      }
    }

    // Long answers wrap. Absorb continuation lines — for free-text fields only —
    // until the next label or the end of the inquiry (signature, footer, link).
    if (MULTILINE.has(hit.field) && value) {
      for (; j < lines.length && value.length < 4000; j++) {
        const next = lines[j].trim();
        if (!next) continue;
        if (isBodyBoundary(next) || matchLabelLine(next) || looksLikeLabelLine(next) || isChrome(next)) break;
        value = `${value} ${next}`.replace(/\s+/g, ' ').trim();
      }
    }

    i = j - 1;
    if (value && !out[hit.field]) out[hit.field] = value;
  }
  return out;
}

// ── Field normalisers ────────────────────────────────────────────────────────

/** Normalise to E.164-ish digits, or null when it is not a usable number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 10 && digits.length <= 15 && raw.trim().startsWith('+') ? `+${digits}` : null;
}

/** Toll-free prefixes: a company switchboard, never a couple's cell. */
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);

/** A North American number in free text, with boundaries so ID/URL digit runs never match. */
const FREE_PHONE_RE = /(?<![\w/=.#-])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})(?![\w/=-])/g;

function findFreeTextPhone(text: string, id: Identity): string | null {
  const noUrls = text.replace(/https?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ');
  for (const m of noUrls.matchAll(FREE_PHONE_RE)) {
    if (TOLL_FREE.has(m[1])) continue;
    const e164 = `+1${m[1]}${m[2]}${m[3]}`;
    if (isVenuePhone(e164, id)) continue;
    return e164;
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_SRC = '(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\\.?';

/**
 * Parse an explicit calendar date into YYYY-MM-DD, or null.
 *
 * Only a date with a day, a month and a year is accepted, and only one that is
 * not already in the past: "Spring 2027", "June 2027" or "2027" are left empty
 * rather than being turned into the first of the month or the year, which
 * would put a date on the lead that the couple never gave.
 */
export function normalizeDate(raw: string | null | undefined, now: Date = new Date()): string | null {
  if (!raw) return null;
  const t = raw.trim();
  let y = 0;
  let m = 0;
  let d = 0;
  let mm: RegExpExecArray | null;

  if ((mm = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t))) {
    y = +mm[1]; m = +mm[2]; d = +mm[3];
  } else if ((mm = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(t))) {
    m = +mm[1]; d = +mm[2]; y = +mm[3];
    if (y < 100) y += 2000;
    // Unambiguously day-first (e.g. 14/06/2027): swap.
    if (m > 12 && d <= 12) [m, d] = [d, m];
  } else if ((mm = new RegExp(`\\b${MONTH_SRC}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i').exec(t))) {
    m = MONTHS[mm[1].toLowerCase()]; d = +mm[2]; y = +mm[3];
  } else if ((mm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_SRC},?\\s+(\\d{4})\\b`, 'i').exec(t))) {
    d = +mm[1]; m = MONTHS[mm[2].toLowerCase()]; y = +mm[3];
  } else {
    return null;
  }

  if (!m || m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;

  const when = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (when < today - 24 * 60 * 60 * 1000) return null;     // already past: not a wedding date
  if (y > now.getUTCFullYear() + 8) return null;             // implausibly far out

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "150", "1,200", "100-150" (→ 150, the number capacity planning needs), "150+". */
function parseGuestCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/(\d),(\d{3})\b/g, '$1$2');
  const range = /(\d{1,5})\s*(?:-|–|—|to)\s*(\d{1,5})/.exec(s);
  if (range) {
    const hi = Math.max(+range[1], +range[2]);
    if (hi >= 1 && hi <= 5000) return hi;
  }
  const first = /\d{1,5}/.exec(s);
  if (!first) return null;
  const n = +first[0];
  return n >= 1 && n <= 5000 ? n : null;
}

// ── Names ────────────────────────────────────────────────────────────────────

/** Words that mean a candidate is a brand, a role or boilerplate — not a person. */
const NOT_A_PERSON = /\b(the knot|knot|weddingwire|wedding ?wire|weddingpro|zola|partyslate|wedding[- ]?spot|here comes the guide|eventective|inquir(y|ies)|enquir(y|ies)|leads?|venue|notifications?|messages?|team|support|admin|no-?reply|customer service|storyvenue|leadfinder|wedding|website|form|submission|request)\b/i;

function plausiblePersonName(raw: string | null | undefined, id: Identity): string | null {
  if (!raw) return null;
  const v = raw
    .replace(new RegExp(EMAIL_SRC, 'gi'), ' ')
    .replace(/[<>()[\]]/g, ' ')
    .replace(/^["'\s,;:-]+|["'\s,;:-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (v.length < 2 || v.length > 80) return null;
  // Letters, spaces and the punctuation real names use ("O'Neil", "Mary-Kate",
  // "Dana & Chris", "Jr."). Anything else — digits, colons, semicolons, slashes —
  // is a sentence, an ID or an instruction, not a person.
  if (!/^[\p{L}\p{M}\s'’.&,+-]+$/u.test(v)) return null;
  if (!/\p{L}/u.test(v)) return null;
  if (v.split(' ').length > 8) return null;
  if (NOT_A_PERSON.test(v)) return null;
  // The venue's own name (a form notification, a signature, a subject line
  // naming the listing) is never the couple's.
  if (id.name && id.name.length >= 4 && v.toLowerCase().includes(id.name)) return null;
  return v;
}

/**
 * The same person-name check the deterministic pass applies, for callers that
 * get a name from elsewhere (the AI fallback): no brands, roles, sentences, or
 * the venue's own name.
 */
export function plausibleCoupleName(raw: string | null | undefined, venue?: VenueIdentity): string | null {
  return plausiblePersonName(raw, buildIdentity(venue));
}

/** Whether a number belongs to the venue itself (its own line, a signature). */
export function isVenueOwnPhone(phone: string | null | undefined, venue?: VenueIdentity): boolean {
  return !!phone && isVenuePhone(phone, buildIdentity(venue));
}

/** The couple's name as the subject line gives it, when it does. */
function nameFromSubject(subject: string | null, id: Identity): string | null {
  if (!subject) return null;
  const s = subject.replace(/^((re|fwd?|fw)\s*:\s*)+/i, '').trim();
  const patterns = [
    /\b(?:inquiry|enquiry|message|request|lead|note|question)\s+from\s+(.+?)(?:\s+(?:via|on|at|for|about|regarding|re)\b.*)?$/i,
    /^(.+?)\s+(?:sent you a (?:message|request|note|inquiry)|is interested in|wants to (?:know|learn)|has a question|has sent you|requested (?:info|information|pricing|a quote|a tour))\b/i,
    /^new (?:lead|inquiry|enquiry|message)\s*[:\-–]\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    const candidate = plausiblePersonName(m?.[1], id);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Split a display name. "Dana & Chris" and "Dana Smith and Chris Jones" keep
 * the full couple as the name and use the first person for first/last.
 */
function splitName(full: string): { first: string | null; last: string | null } {
  const firstPerson = full.split(/\s+(?:&|and|\+)\s+/i)[0] ?? full;
  const parts = firstPerson.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// ── Extraction ───────────────────────────────────────────────────────────────

function toLines(text: string): string[] {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim());
}

/**
 * Extract what we can. Returns only what was actually found — callers decide
 * what constitutes "enough" to create a lead.
 */
export function extractLeadFromEmail(input: ExtractInput): ExtractedLead {
  const id = buildIdentity(input.venue);
  const allLines = toLines(input.text);

  // A subject starting "Fwd:" means the sender is whoever forwarded it, even
  // when the client did not add a recognisable forwarded-message block.
  const subjectSaysForward = /^\s*(fwd?|fw)\s*:/i.test(input.subject ?? '');
  const fwd = splitForwarded(allLines, id);
  const lines = fwd ? fwd.body : allLines;
  const inquiryText = bodyUntilBoundary(lines).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const labelled = readLabelledFields(lines);

  const senderEmail = (input.senderEmail ?? '').trim().toLowerCase() || null;
  const senderIsVenue = !!senderEmail && isVenueAddress(senderEmail, id);
  // For a forward, the envelope From / Reply-To belong to whoever forwarded it.
  const envelopeIsOriginal = !fwd && !subjectSaysForward;
  // The envelope sender is the couple only when it is the original message and
  // was not sent by the venue itself (a website form notification comes from
  // the venue's domain with the couple in Reply-To).
  const senderMayBeCouple = envelopeIsOriginal && !senderIsVenue;

  const usable = (addr: string | null | undefined): addr is string =>
    !!addr && !isVenueAddress(addr, id) && !isSystemSender(addr);
  const isMarketplace = (addr: string) => !!sourceForDomain(domainOf(addr));

  // ── Email: labelled → forwarded original sender → Reply-To → sender → body.
  let email: string | null = null;
  let emailSource: EmailSource | null = null;
  let emailIsRelay = false;
  let relayCandidate: string | null = null;

  const labelledEmail = emailsIn(labelled.email)[0];
  let ignoredVenueEmail: string | null = labelledEmail && isVenueAddress(labelledEmail, id) ? labelledEmail : null;
  if (usable(labelledEmail)) {
    email = labelledEmail;
    emailSource = 'labelled';
    emailIsRelay = isMarketplace(labelledEmail);
  }
  if (!email && fwd?.headers.fromEmail && usable(fwd.headers.fromEmail) && !isMarketplace(fwd.headers.fromEmail)) {
    email = fwd.headers.fromEmail;
    emailSource = 'forwarded_sender';
  }
  if (!email && envelopeIsOriginal) {
    const replyTo = emailsIn(input.replyTo)[0];
    if (usable(replyTo)) {
      if (isMarketplace(replyTo)) relayCandidate = replyTo;
      else {
        email = replyTo;
        emailSource = 'reply_to';
      }
    }
  }
  if (!email && senderMayBeCouple && usable(senderEmail) && !isMarketplace(senderEmail)) {
    email = senderEmail;
    emailSource = 'sender';
  }
  if (!email) {
    const fromBody = emailsIn(inquiryText).find((a) => usable(a) && !isMarketplace(a) && !ROLE_LOCAL.test(localPart(a).split('+')[0]));
    if (fromBody) {
      email = fromBody;
      emailSource = 'body';
    }
  }
  if (!email && relayCandidate) {
    email = relayCandidate;
    emailSource = 'reply_to';
    emailIsRelay = true;
  }
  if (!email && !ignoredVenueEmail) {
    ignoredVenueEmail = emailsIn(inquiryText).find((a) => isVenueAddress(a, id)) ?? null;
  }

  // ── Phone: a labelled field, else one clearly in the inquiry (never a
  //    toll-free switchboard, a link, or the venue's own number).
  let phone: string | null = null;
  let phoneLabelled = false;
  const labelledPhone = normalizePhone(labelled.phone);
  if (labelledPhone && !isVenuePhone(labelledPhone, id)) {
    phone = labelledPhone;
    phoneLabelled = true;
  } else if (!labelled.phone) {
    phone = findFreeTextPhone(inquiryText, id);
  }

  // ── Name: labelled → first+last → the display name that belongs to the
  //    address we chose → the subject line.
  const replyToName = displayNameOf(input.replyTo);
  const combined = [labelled.firstName, labelled.lastName].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  const nameCandidates: Array<string | null | undefined> = [
    labelled.name,
    combined,
    emailSource === 'forwarded_sender' ? fwd?.headers.fromName : null,
    emailSource === 'reply_to' ? replyToName : null,
    emailSource === 'sender' ? input.senderName : null,
    nameFromSubject(fwd?.headers.subject ?? input.subject, id),
  ];
  let name: string | null = null;
  for (const c of nameCandidates) {
    name = plausiblePersonName(c, id);
    if (name) break;
  }
  let firstName: string | null = null;
  let lastName: string | null = null;
  if (labelled.firstName && name === plausiblePersonName(combined, id)) {
    firstName = labelled.firstName.trim() || null;
    lastName = labelled.lastName?.trim() || null;
  } else if (name) {
    ({ first: firstName, last: lastName } = splitName(name));
  }

  // ── Message: the labelled answer; for an email the couple wrote themselves
  //    (not a marketplace template), the body of that email.
  let message = labelled.message ? cleanValue(labelled.message).slice(0, 4000) : null;
  if (!message && (emailSource === 'sender' || emailSource === 'forwarded_sender') && Object.keys(labelled).length === 0) {
    const prose = inquiryText.replace(/\s+/g, ' ').trim();
    if (prose.length >= 10) message = prose.slice(0, 4000);
  }

  // "When: Saturday, June 14, 2027" is a date, not a planning timeline.
  let weddingDate = normalizeDate(labelled.weddingDate);
  let timeline = labelled.timeline ? cleanValue(labelled.timeline).slice(0, 200) : null;
  if (!weddingDate && timeline) {
    const fromTimeline = normalizeDate(timeline);
    if (fromTimeline) {
      weddingDate = fromTimeline;
      timeline = null;
    }
  }

  const result: ExtractedLead = {
    name,
    firstName,
    lastName,
    email,
    phone,
    weddingDate,
    guestCount: parseGuestCount(labelled.guestCount),
    venueMatters: labelled.wants ? cleanValue(labelled.wants).slice(0, 2000) : null,
    timeline,
    message,
    found: [],
    emailSource,
    emailIsRelay,
    phoneLabelled,
    forwarded: fwd?.headers ?? null,
    ignoredVenueEmail: email ? null : ignoredVenueEmail,
    inquiryText,
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
 * The marketplace an arrival came from: the sender's domain, or — for a
 * forward — the domain of the message that was forwarded.
 */
export function detectSource(senderDomain: string | null, extracted: Pick<ExtractedLead, 'forwarded'> | null): string | null {
  return sourceForDomain(senderDomain) ?? sourceForDomain(domainOf(extracted?.forwarded?.fromEmail ?? null));
}

/**
 * Decide whether a message is an inquiry, and how sure we are.
 *
 * Deliberately biased toward keeping a message: a false positive costs an
 * ignorable lead, a false negative loses a couple. Only subjects that are
 * clearly account notifications, bounces or auto-replies are rejected outright.
 */
export function classifyInbound(args: {
  subject: string | null;
  senderDomain: string | null;
  senderEmail?: string | null;
  extracted: ExtractedLead;
}): Classification {
  const detectedSource = detectSource(args.senderDomain, args.extracted);

  if (isLikelyNotLead(args.subject) || isLikelyNotLead(args.extracted.forwarded?.subject)) {
    return { accept: false, reason: 'not_an_inquiry_subject', detectedSource, confidence: 0 };
  }
  if (args.senderEmail && /^(mailer-daemon|postmaster)$/i.test(localPart(args.senderEmail))) {
    return { accept: false, reason: 'bounce_or_system_message', detectedSource, confidence: 0 };
  }

  // `leads.email` is NOT NULL with no database default, so a message we cannot
  // reply to by email cannot become a lead. Rejected rows are still recorded
  // with a reason rather than dropped, so a phone-only arrival stays visible.
  if (!args.extracted.email) {
    // The one address in it is the venue's own (e.g. someone tested with the
    // venue's notification email as the "couple"): say that, not "no email".
    const reason = args.extracted.ignoredVenueEmail ? 'only_venue_email' : 'no_email_address';
    return { accept: false, reason, detectedSource, confidence: 0 };
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
