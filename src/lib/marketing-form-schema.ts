export const MARKETING_FORM_SCHEMA_VERSION = 1 as const;

export type FormBlockType =
  | 'heading'
  | 'rich_text'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'date'
  | 'address'
  | 'image'
  | 'file'
  | 'html'
  | 'radio'
  | 'select'
  | 'checkbox_group'
  | 'textarea'
  | 'submit'
  | 'button'
  | 'venue_contact';

/** Per-block typography (builder + public form). */
export interface FormBlockStyle {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: string;
  /** Sentence case vs all caps (heading blocks) */
  textTransform?: 'none' | 'uppercase';
}

/** After successful submit (public embed + preview). */
export interface PostSubmitConfig {
  /** default = short built-in thanks; inline_message = stay on page; redirect = leave */
  mode?: 'default' | 'inline_message' | 'redirect';
  /** Shown when mode is inline_message (sanitized HTML subset) */
  messageHtml?: string;
  /** Absolute or same-origin relative URL when mode is redirect */
  redirectUrl?: string;
}

export interface FormTheme {
  maxWidth?: string;
  primaryColor?: string;
  background?: string;
  surface?: string;
  /** Body / general font stack */
  fontFamily?: string;
  /** Heading-specific font (h1-h6). Falls back to fontFamily if unset. */
  headingFontFamily?: string;
  borderRadius?: string;
  labelColor?: string;
  inputBorder?: string;
  mutedColor?: string;
}

export interface FormBlock {
  id: string;
  type: FormBlockType;
  label?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  /** heading text, rich_text HTML, raw html block */
  content?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  options?: string[];
  src?: string;
  alt?: string;
  href?: string;
  buttonVariant?: 'primary' | 'secondary' | 'outline' | 'link';
  /** Alignment for button / submit blocks (left | center | right) */
  buttonAlign?: 'left' | 'center' | 'right';
  /** submit / button label */
  buttonLabel?: string;
  /** optional stable key for exports (defaults to block id in payloads) */
  fieldKey?: string;
  style?: FormBlockStyle;
  /** Grid column span: 1 = half-width, 2 = full-width (default full) */
  colSpan?: 1 | 2;
  /** textarea height: small (~3 rows), medium (~6 rows, default), large (~10 rows) */
  textareaSize?: 'small' | 'medium' | 'large';
  /** checkbox_group: 'single' behaves like radio (one choice), 'multiple' allows many */
  checkboxMode?: 'single' | 'multiple';

  // ─── Block-level formatting (mirrors the email builder) ────────────────────
  /** Per-block outer padding, in pixels. Falls back to FORM_BLOCK_PADDING_DEFAULTS. */
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  /** Per-block background color (any CSS color, or 'transparent'). */
  blockBgColor?: string;
}

/** Per-type fallback padding when a block doesn't specify its own. Set to 0
 * across the board so existing forms render exactly the same — opt-in by
 * editing in the Block sub-tab of the inspector. */
export const FORM_BLOCK_PADDING_DEFAULTS: Record<
  FormBlockType,
  { top: number; bottom: number; left: number; right: number }
> = {
  heading:        { top: 0, bottom: 0, left: 0, right: 0 },
  rich_text:      { top: 0, bottom: 0, left: 0, right: 0 },
  first_name:     { top: 0, bottom: 0, left: 0, right: 0 },
  last_name:      { top: 0, bottom: 0, left: 0, right: 0 },
  email:          { top: 0, bottom: 0, left: 0, right: 0 },
  phone:          { top: 0, bottom: 0, left: 0, right: 0 },
  url:            { top: 0, bottom: 0, left: 0, right: 0 },
  number:         { top: 0, bottom: 0, left: 0, right: 0 },
  date:           { top: 0, bottom: 0, left: 0, right: 0 },
  address:        { top: 0, bottom: 0, left: 0, right: 0 },
  image:          { top: 0, bottom: 0, left: 0, right: 0 },
  file:           { top: 0, bottom: 0, left: 0, right: 0 },
  html:           { top: 0, bottom: 0, left: 0, right: 0 },
  radio:          { top: 0, bottom: 0, left: 0, right: 0 },
  select:         { top: 0, bottom: 0, left: 0, right: 0 },
  checkbox_group: { top: 0, bottom: 0, left: 0, right: 0 },
  textarea:       { top: 0, bottom: 0, left: 0, right: 0 },
  submit:         { top: 0, bottom: 0, left: 0, right: 0 },
  button:         { top: 0, bottom: 0, left: 0, right: 0 },
  venue_contact:  { top: 0, bottom: 0, left: 0, right: 0 },
};

/** Resolved padding for a block — explicit fields win, otherwise type default. */
export function resolveBlockPadding(block: FormBlock): { top: number; bottom: number; left: number; right: number } {
  const d = FORM_BLOCK_PADDING_DEFAULTS[block.type] ?? { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    top:    block.paddingTop    ?? d.top,
    bottom: block.paddingBottom ?? d.bottom,
    left:   block.paddingLeft   ?? d.left,
    right:  block.paddingRight  ?? d.right,
  };
}

/** Per-form submission routing and notification settings. */
export interface FormSettings {
  /** Comma-separated email addresses to notify on every submission. */
  notificationEmails?: string;
  /** Pipeline stage ID to route new submissions into (creates a lead + contact). */
  pipelineStageId?: string | null;
}

export interface MarketingFormDefinition {
  version: typeof MARKETING_FORM_SCHEMA_VERSION;
  blocks: FormBlock[];
  theme?: FormTheme;
  postSubmit?: PostSubmitConfig;
  settings?: FormSettings;
}

export function defaultPostSubmit(): PostSubmitConfig {
  return { mode: 'default' };
}

export const FORM_BLOCK_TYPES: FormBlockType[] = [
  'heading',
  'rich_text',
  'first_name',
  'last_name',
  'email',
  'phone',
  'url',
  'number',
  'date',
  'address',
  'image',
  'file',
  'html',
  'radio',
  'select',
  'checkbox_group',
  'textarea',
  'submit',
  'button',
  'venue_contact',
];

/** These blocks are always required — the toggle is hidden in the builder. */
export const ALWAYS_REQUIRED_TYPES: FormBlockType[] = [
  'first_name',
  'last_name',
  'email',
  'phone',
];

/** Blocks that collect user input (excludes submit/button/layout). */
export const INPUT_BLOCK_TYPES: FormBlockType[] = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'url',
  'number',
  'date',
  'address',
  'file',
  'radio',
  'select',
  'checkbox_group',
  'textarea',
];

const DEFAULT_THEME: Required<FormTheme> = {
  maxWidth: '520px',
  primaryColor: '#111827',
  background: '#f3f4f6',
  surface: '#ffffff',
  fontFamily:
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  headingFontFamily: '',
  borderRadius: '10px',
  labelColor: '#374151',
  inputBorder: '#e5e7eb',
  mutedColor: '#6b7280',
};

export function mergeTheme(theme?: FormTheme): Required<FormTheme> {
  return { ...DEFAULT_THEME, ...theme };
}

export function emptyDefinition(): MarketingFormDefinition {
  return {
    version: MARKETING_FORM_SCHEMA_VERSION,
    blocks: [],
    theme: { ...DEFAULT_THEME },
  };
}

export function defaultDefinition(): MarketingFormDefinition {
  return {
    version: MARKETING_FORM_SCHEMA_VERSION,
    blocks: [
      {
        id: crypto.randomUUID(),
        type: 'heading',
        level: 2,
        content: 'Contact us',
      },
      {
        id: crypto.randomUUID(),
        type: 'rich_text',
        content: '<p>Tell us about your event.</p>',
      },
      {
        id: crypto.randomUUID(),
        type: 'email',
        label: 'Email',
        placeholder: 'you@example.com',
        required: true,
      },
      {
        id: crypto.randomUUID(),
        type: 'venue_contact',
      },
      {
        id: crypto.randomUUID(),
        type: 'submit',
        buttonLabel: 'Submit',
      },
    ],
    theme: { ...DEFAULT_THEME },
    postSubmit: defaultPostSubmit(),
  };
}

export function createBlock(type: FormBlockType): FormBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case 'heading':
      return { id, type, level: 2, content: 'Heading' };
    case 'rich_text':
      return { id, type, content: '<p>Paragraph text</p>' };
    case 'first_name':
      return { id, type, label: 'First name', placeholder: 'Jane', required: true };
    case 'last_name':
      return { id, type, label: 'Last name', placeholder: 'Doe', required: true };
    case 'email':
      return { id, type, label: 'Email', placeholder: 'you@example.com', required: true };
    case 'phone':
      return { id, type, label: 'Phone', placeholder: '+1 (555) 000-0000', required: true };
    case 'url':
      return { id, type, label: 'Website', placeholder: 'https://', required: false };
    case 'number':
      return { id, type, label: 'Number', placeholder: '0', required: false };
    case 'date':
      return { id, type, label: 'Date', required: false };
    case 'address':
      return { id, type, label: 'Address', placeholder: 'Street, city, state, ZIP', required: false };
    case 'image':
      return { id, type, src: '', alt: '' };
    case 'file':
      return { id, type, label: 'Attachment', required: false };
    case 'html':
      return { id, type, content: '<p>Custom HTML</p>' };
    case 'radio':
      return {
        id,
        type,
        label: 'Choose one',
        options: ['Option A', 'Option B'],
        required: false,
      };
    case 'select':
      return {
        id,
        type,
        label: 'Dropdown',
        options: ['First choice', 'Second choice'],
        required: false,
      };
    case 'checkbox_group':
      return {
        id,
        type,
        label: 'Select any',
        options: ['Choice 1', 'Choice 2'],
        required: false,
        checkboxMode: 'multiple' as const,
      };
    case 'textarea':
      return {
        id,
        type,
        label: 'Comments / Questions',
        placeholder: 'Type your message here…',
        required: false,
        textareaSize: 'medium' as const,
      };
    case 'submit':
      return { id, type, buttonLabel: 'Submit' };
    case 'button':
      return {
        id,
        type,
        buttonLabel: 'Learn more',
        href: 'https://',
        buttonVariant: 'secondary',
      };
    case 'venue_contact':
      return { id, type: 'venue_contact' };
    default:
      return { id, type: 'heading', level: 2, content: 'Block' };
  }
}

/** Deep clone a block with a new id (builder duplicate). */
export function duplicateBlock(block: FormBlock): FormBlock {
  const raw = JSON.parse(JSON.stringify(block)) as FormBlock;
  raw.id = crypto.randomUUID();
  return raw;
}

/** Stable `name` / FormData key for this block (embed + submit API). */
export function formFieldName(block: FormBlock): string {
  return `bf_${block.id}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function parseDefinition(raw: unknown): MarketingFormDefinition {
  if (!isObject(raw)) return emptyDefinition();
  // Be lenient: older or newer version numbers still parse blocks when present.
  const version =
    typeof raw.version === 'number' ? raw.version : MARKETING_FORM_SCHEMA_VERSION;
  const blocksRaw = raw.blocks;
  if (!Array.isArray(blocksRaw)) {
    return {
      version: MARKETING_FORM_SCHEMA_VERSION,
      blocks: [],
      theme: mergeTheme(raw.theme as FormTheme),
      postSubmit: parsePostSubmit(raw.postSubmit),
    };
  }
  const blocks: FormBlock[] = [];
  for (const b of blocksRaw) {
    if (!isObject(b) || typeof b.id !== 'string' || typeof b.type !== 'string') continue;
    if (!FORM_BLOCK_TYPES.includes(b.type as FormBlockType)) continue;
    const block = { ...b, type: b.type as FormBlockType } as FormBlock;
    blocks.push(block);
  }
  const theme = isObject(raw.theme) ? (raw.theme as FormTheme) : undefined;
  const postSubmit = parsePostSubmit(raw.postSubmit);
  const settings = parseFormSettings(raw.settings);
  return {
    version: MARKETING_FORM_SCHEMA_VERSION,
    blocks,
    theme: theme ? mergeTheme(theme) : undefined,
    postSubmit,
    ...(settings ? { settings } : {}),
  };
}

function parseFormSettings(raw: unknown): FormSettings | undefined {
  if (!isObject(raw)) return undefined;
  const notificationEmails =
    typeof raw.notificationEmails === 'string' ? raw.notificationEmails : undefined;
  const pipelineStageId =
    typeof raw.pipelineStageId === 'string' ? raw.pipelineStageId : null;
  if (!notificationEmails && pipelineStageId === null) return undefined;
  return {
    ...(notificationEmails !== undefined ? { notificationEmails } : {}),
    ...(pipelineStageId !== null ? { pipelineStageId } : {}),
  };
}

function parsePostSubmit(raw: unknown): PostSubmitConfig | undefined {
  if (!isObject(raw)) return undefined;
  const mode = raw.mode;
  const m =
    mode === 'inline_message' || mode === 'redirect' || mode === 'default' ? mode : undefined;
  const messageHtml = typeof raw.messageHtml === 'string' ? raw.messageHtml : undefined;
  const redirectUrl = typeof raw.redirectUrl === 'string' ? raw.redirectUrl : undefined;
  if (!m && !messageHtml && !redirectUrl) return undefined;
  return { mode: m ?? 'default', messageHtml, redirectUrl };
}

export function serializeDefinition(def: MarketingFormDefinition): MarketingFormDefinition {
  return {
    version: MARKETING_FORM_SCHEMA_VERSION,
    blocks: def.blocks.map((b) => ({ ...b })),
    theme: def.theme ? mergeTheme(def.theme) : mergeTheme({}),
    ...(def.postSubmit ? { postSubmit: { ...def.postSubmit } } : {}),
    ...(def.settings ? { settings: { ...def.settings } } : {}),
  };
}

/** Resolved post-submit behavior for API + embed. */
export function resolvePostSubmit(def: MarketingFormDefinition): Required<PostSubmitConfig> {
  const p = def.postSubmit ?? {};
  const mode = p.mode ?? 'default';
  return {
    mode: mode === 'redirect' || mode === 'inline_message' ? mode : 'default',
    messageHtml: p.messageHtml ?? '<p>Thanks — your response was recorded.</p>',
    redirectUrl: p.redirectUrl?.trim() ?? '',
  };
}
