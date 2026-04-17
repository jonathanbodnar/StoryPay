export const MARKETING_EMAIL_SCHEMA_VERSION = 1 as const;

export type EmailBlockType =
  | 'heading'
  | 'text'
  | 'button'
  | 'image'
  | 'divider'
  | 'spacer'
  | 'html'
  | 'columns';

export interface EmailBlock {
  id: string;
  type: EmailBlockType;
  content?: string;
  level?: 1 | 2 | 3;
  align?: 'left' | 'center' | 'right';
  href?: string;
  buttonLabel?: string;
  src?: string;
  alt?: string;
  spacerHeight?: number;
  /** For type `columns` — two stacks of inner blocks (email-client safe table layout). */
  left?: EmailBlock[];
  right?: EmailBlock[];
}

export interface EmailTheme {
  pageBg?: string;
  cardBg?: string;
  textColor?: string;
  mutedColor?: string;
  buttonBg?: string;
  buttonText?: string;
  maxWidth?: string;
  fontFamily?: string;
}

export interface MarketingEmailDefinition {
  version: typeof MARKETING_EMAIL_SCHEMA_VERSION;
  blocks: EmailBlock[];
  theme?: EmailTheme;
}

export interface MarketingEmailTemplateRow {
  id: string;
  venue_id: string;
  name: string;
  subject: string;
  preheader: string;
  definition_json: unknown;
  created_at: string;
  updated_at: string;
}

export function emptyEmailDefinition(): MarketingEmailDefinition {
  return {
    version: MARKETING_EMAIL_SCHEMA_VERSION,
    blocks: [],
    theme: {},
  };
}

export function defaultEmailDefinition(): MarketingEmailDefinition {
  return {
    version: MARKETING_EMAIL_SCHEMA_VERSION,
    blocks: [
      { id: crypto.randomUUID(), type: 'heading', level: 1, align: 'center', content: 'Hello {{first_name}}' },
      {
        id: crypto.randomUUID(),
        type: 'text',
        align: 'left',
        content: '<p>We are excited to share an update from {{venue_name}}.</p>',
      },
      {
        id: crypto.randomUUID(),
        type: 'button',
        align: 'center',
        buttonLabel: 'View details',
        href: 'https://',
      },
    ],
    theme: {
      pageBg: '#f4f4f5',
      cardBg: '#ffffff',
      textColor: '#18181b',
      mutedColor: '#71717a',
      buttonBg: '#18181b',
      buttonText: '#ffffff',
      maxWidth: '600px',
      fontFamily: "Georgia, 'Times New Roman', serif",
    },
  };
}

const BLOCK_TYPES: EmailBlockType[] = [
  'heading',
  'text',
  'button',
  'image',
  'divider',
  'spacer',
  'html',
  'columns',
];

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseBlocks(raw: unknown): EmailBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailBlock[] = [];
  for (const b of raw) {
    if (!isObject(b) || typeof b.id !== 'string' || typeof b.type !== 'string') continue;
    if (!BLOCK_TYPES.includes(b.type as EmailBlockType)) continue;
    const block = { ...b, type: b.type as EmailBlockType } as EmailBlock;
    if (block.type === 'columns') {
      const left = parseBlocks((b as { left?: unknown }).left);
      const right = parseBlocks((b as { right?: unknown }).right);
      block.left = left;
      block.right = right;
    }
    out.push(block);
  }
  return out;
}

export function parseEmailDefinition(raw: unknown): MarketingEmailDefinition {
  if (!isObject(raw)) return emptyEmailDefinition();
  if (raw.version !== MARKETING_EMAIL_SCHEMA_VERSION) return emptyEmailDefinition();
  const theme = isObject(raw.theme) ? (raw.theme as EmailTheme) : undefined;
  return {
    version: MARKETING_EMAIL_SCHEMA_VERSION,
    blocks: parseBlocks(raw.blocks),
    theme,
  };
}

export function mergeEmailTheme(theme?: EmailTheme): Required<EmailTheme> {
  const d: Required<EmailTheme> = {
    pageBg: '#f4f4f5',
    cardBg: '#ffffff',
    textColor: '#18181b',
    mutedColor: '#71717a',
    buttonBg: '#18181b',
    buttonText: '#ffffff',
    maxWidth: '600px',
    fontFamily: "Georgia, 'Times New Roman', serif",
  };
  return { ...d, ...theme };
}

export function createEmailBlock(type: EmailBlockType): EmailBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case 'heading':
      return { id, type, level: 2, align: 'left', content: 'Heading' };
    case 'text':
      return { id, type, align: 'left', content: '<p>Your message here.</p>' };
    case 'button':
      return { id, type, align: 'center', buttonLabel: 'Click here', href: 'https://' };
    case 'image':
      return { id, type, align: 'center', src: '', alt: '' };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, spacerHeight: 24 };
    case 'html':
      return { id, type, content: '<p>Custom HTML</p>' };
    case 'columns':
      return { id, type, left: [], right: [] };
    default:
      return { id, type: 'text', content: '' };
  }
}

/** Campaign / builder segment JSON */
export type SegmentType = 'all_leads' | 'tags_any' | 'stages';

export interface CampaignSegment {
  type: SegmentType;
  tag_ids?: string[];
  stage_ids?: string[];
}

export function parseSegment(raw: unknown): CampaignSegment {
  if (!isObject(raw)) return { type: 'all_leads' };
  const t = raw.type;
  if (t === 'tags_any' && Array.isArray(raw.tag_ids)) {
    return { type: 'tags_any', tag_ids: raw.tag_ids.filter((x): x is string => typeof x === 'string') };
  }
  if (t === 'stages' && Array.isArray(raw.stage_ids)) {
    return { type: 'stages', stage_ids: raw.stage_ids.filter((x): x is string => typeof x === 'string') };
  }
  return { type: 'all_leads' };
}

export type AutomationTriggerType = 'tag_added' | 'stage_changed' | 'trigger_link_click';

export interface AutomationTriggerConfig {
  /** tag_added: fire when any of these tags are added (empty = any tag) */
  tag_ids?: string[];
  /** stage_changed: fire when lead moves into one of these stages */
  to_stage_ids?: string[];
  /** trigger_link_click: these link ids */
  trigger_link_ids?: string[];
}
