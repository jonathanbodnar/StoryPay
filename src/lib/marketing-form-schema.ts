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
  | 'button';

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

  // ─── Button styling (mirrors the email builder) ───────────────────────────
  /** Preset combining fill/outline + corner radius. Overrides buttonVariant when set. */
  buttonStyle?:
    | 'filled-rect'
    | 'filled-rounded'
    | 'filled-rounded-lg'
    | 'filled-pill'
    | 'outline-rect'
    | 'outline-rounded'
    | 'outline-rounded-lg'
    | 'outline-pill';
  /** Custom button fill color (overrides preset / theme). */
  buttonBgColor?: string;
  /** Custom button text color. */
  buttonTextColor?: string;
  /** Custom button border color (used by outline presets). */
  buttonBorderColor?: string;
  /** Custom button border width in px. */
  buttonBorderWidth?: number;
  /** Custom vertical button padding in px (controls "height"). */
  buttonHeight?: number;
  /** Render the button at full container width. */
  buttonFullWidth?: boolean;
  /** optional stable key for exports (defaults to block id in payloads) */
  fieldKey?: string;
  style?: FormBlockStyle;
  /** Grid column span: 1 = half-width, 2 = full-width (default full) */
  colSpan?: 1 | 2;
  /** textarea height: small (~3 rows), medium (~6 rows, default), large (~10 rows) */
  textareaSize?: 'small' | 'medium' | 'large';
  /** checkbox_group: 'single' behaves like radio (one choice), 'multiple' allows many */
  checkboxMode?: 'single' | 'multiple';

  // ─── Image-block extras (mirrors the email builder) ───────────────────────
  /** Image render width in px (capped to the form max width). Defaults to 600. */
  imageWidth?: number;
  /** Image link target — used when `href` is set on an image block. */
  linkOpenInNewTab?: boolean;

  // ─── Address-block field visibility ────────────────────────────────────────
  /** Show the optional second-line / apt / suite input. Default false. */
  addressShowLine2?: boolean;
  /** Show a country input as the last row. Default false. */
  addressShowCountry?: boolean;

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
  primaryColor: '#1b1b1b',
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
      // First name + last name share the first row at half-width each.
      {
        id: crypto.randomUUID(),
        type: 'first_name',
        label: 'First name',
        placeholder: 'Jane',
        required: true,
        colSpan: 1,
      },
      {
        id: crypto.randomUUID(),
        type: 'last_name',
        label: 'Last name',
        placeholder: 'Doe',
        required: true,
        colSpan: 1,
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
        type: 'phone',
        label: 'Phone',
        placeholder: '+1 (555) 000-0000',
        required: true,
      },
      {
        id: crypto.randomUUID(),
        type: 'submit',
        buttonLabel: 'Submit',
        buttonStyle: 'filled-rounded',
        buttonFullWidth: true,
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
      return { id, type, label: 'Address', required: false };
    case 'image':
      return { id, type, src: '', alt: '', imageWidth: 600 };
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
      return {
        id,
        type,
        buttonLabel: 'Submit',
        buttonStyle: 'filled-rounded',
        buttonFullWidth: true,
      };
    case 'button':
      return {
        id,
        type,
        buttonLabel: 'Learn more',
        href: 'https://',
        buttonStyle: 'filled-rounded',
      };
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

// ─── Address block sub-field schema ──────────────────────────────────────────
//
// The address block is rendered as several individual inputs (street, city,
// state, ZIP, plus optional line 2 + country) — each carries its own FormData
// name, suffixed with the key below. All sub-fields are stored as a single
// object on the submission payload under the parent block id.

export const ADDRESS_FIELD_KEYS = [
  'line1',
  'line2',
  'city',
  'state',
  'zip',
  'country',
] as const;
export type AddressFieldKey = (typeof ADDRESS_FIELD_KEYS)[number];

export const ADDRESS_FIELD_LABELS: Record<AddressFieldKey, string> = {
  line1:   'Street address',
  line2:   'Apt, suite, etc.',
  city:    'City',
  state:   'State',
  zip:     'ZIP / Postal code',
  country: 'Country',
};

export const ADDRESS_FIELD_PLACEHOLDERS: Record<AddressFieldKey, string> = {
  line1:   '123 Main St',
  line2:   'Apt 4B',
  city:    'Brooklyn',
  state:   'NY',
  zip:     '11201',
  country: 'United States',
};

/** Auto-completion hints for the address sub-fields. */
export const ADDRESS_FIELD_AUTOCOMPLETE: Record<AddressFieldKey, string> = {
  line1:   'address-line1',
  line2:   'address-line2',
  city:    'address-level2',
  state:   'address-level1',
  zip:     'postal-code',
  country: 'country-name',
};

/** Visible sub-field keys for an address block, honoring the line2/country toggles. */
export function addressVisibleKeys(block: FormBlock): AddressFieldKey[] {
  const out: AddressFieldKey[] = ['line1'];
  if (block.addressShowLine2) out.push('line2');
  out.push('city', 'state', 'zip');
  if (block.addressShowCountry) out.push('country');
  return out;
}

/** FormData key for an individual address sub-field. */
export function addressFieldName(block: FormBlock, key: AddressFieldKey): string {
  return `${formFieldName(block)}__${key}`;
}

/** Format an address-payload object into a single, comma-joined human string
 *  for emails / inbox previews. Returns "" if the object is empty. */
export function formatAddressValue(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const v = value as Partial<Record<AddressFieldKey, string>>;
  const cityStateZip = [v.city, [v.state, v.zip].filter(Boolean).join(' ').trim()]
    .filter(Boolean)
    .join(', ');
  return [v.line1, v.line2, cityStateZip, v.country]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(', ');
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

// ─── Button preset table (same combos as the email builder) ─────────────────
export type ButtonPresetId = NonNullable<FormBlock['buttonStyle']>;
export const BUTTON_PRESETS: Array<{ id: ButtonPresetId; filled: boolean; radius: number }> = [
  { id: 'filled-rect',         filled: true,  radius: 0   },
  { id: 'filled-rounded',      filled: true,  radius: 4   },
  { id: 'filled-rounded-lg',   filled: true,  radius: 10  },
  { id: 'filled-pill',         filled: true,  radius: 999 },
  { id: 'outline-rect',        filled: false, radius: 0   },
  { id: 'outline-rounded',     filled: false, radius: 4   },
  { id: 'outline-rounded-lg',  filled: false, radius: 10  },
  { id: 'outline-pill',        filled: false, radius: 999 },
];

/** Resolved button rendering style after applying preset + per-block overrides. */
export interface ResolvedButtonStyle {
  filled: boolean;
  radius: number;
  bg: string;
  fg: string;
  borderColor: string;
  borderWidth: number;
  paddingY: number;
  fullWidth: boolean;
}

/** Compute the final visual style for a submit/button block, falling back to
 *  the theme's primary color and sensible defaults that match the email builder.
 *  Honors the legacy `buttonVariant` field when no preset has been set yet. */
export function resolveButtonStyle(
  block: FormBlock,
  theme: Required<FormTheme>,
): ResolvedButtonStyle {
  let presetId: ButtonPresetId | undefined = block.buttonStyle;
  if (!presetId) {
    switch (block.buttonVariant) {
      case 'outline':   presetId = 'outline-rounded'; break;
      case 'link':      presetId = 'outline-rect'; break;
      case 'secondary':
      case 'primary':
      default:          presetId = 'filled-rounded'; break;
    }
  }
  const preset = BUTTON_PRESETS.find((p) => p.id === presetId) ?? BUTTON_PRESETS[1];
  const filled = preset.filled;
  const bg = block.buttonBgColor ?? (filled ? theme.primaryColor : 'transparent');
  const fg = block.buttonTextColor ?? (filled ? '#ffffff' : theme.primaryColor);
  const borderColor = block.buttonBorderColor ?? theme.primaryColor;
  const borderWidth =
    block.buttonBorderWidth ?? (filled ? 0 : 2);
  return {
    filled,
    radius: preset.radius,
    bg,
    fg,
    borderColor,
    borderWidth,
    paddingY: block.buttonHeight ?? 12,
    fullWidth: !!block.buttonFullWidth,
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
