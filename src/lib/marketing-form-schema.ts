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
  | 'submit'
  | 'button';

export interface FormTheme {
  maxWidth?: string;
  primaryColor?: string;
  background?: string;
  surface?: string;
  fontFamily?: string;
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
  /** submit / button label */
  buttonLabel?: string;
  /** optional stable key for exports (defaults to block id in payloads) */
  fieldKey?: string;
}

export interface MarketingFormDefinition {
  version: typeof MARKETING_FORM_SCHEMA_VERSION;
  blocks: FormBlock[];
  theme?: FormTheme;
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
  'submit',
  'button',
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
];

const DEFAULT_THEME: Required<FormTheme> = {
  maxWidth: '520px',
  primaryColor: '#111827',
  background: '#f3f4f6',
  surface: '#ffffff',
  fontFamily:
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
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
        type: 'submit',
        buttonLabel: 'Submit',
      },
    ],
    theme: { ...DEFAULT_THEME },
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
      return { id, type, label: 'First name', placeholder: 'Jane', required: false };
    case 'last_name':
      return { id, type, label: 'Last name', placeholder: 'Doe', required: false };
    case 'email':
      return { id, type, label: 'Email', placeholder: 'you@example.com', required: true };
    case 'phone':
      return { id, type, label: 'Phone', placeholder: '+1 (555) 000-0000', required: false };
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
    default:
      return { id, type: 'heading', level: 2, content: 'Block' };
  }
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
  const version = raw.version;
  if (version !== MARKETING_FORM_SCHEMA_VERSION) {
    return emptyDefinition();
  }
  const blocksRaw = raw.blocks;
  if (!Array.isArray(blocksRaw)) {
    return { version: MARKETING_FORM_SCHEMA_VERSION, blocks: [], theme: mergeTheme(raw.theme as FormTheme) };
  }
  const blocks: FormBlock[] = [];
  for (const b of blocksRaw) {
    if (!isObject(b) || typeof b.id !== 'string' || typeof b.type !== 'string') continue;
    if (!FORM_BLOCK_TYPES.includes(b.type as FormBlockType)) continue;
    const block = { ...b, type: b.type as FormBlockType } as FormBlock;
    blocks.push(block);
  }
  const theme = isObject(raw.theme) ? (raw.theme as FormTheme) : undefined;
  return {
    version: MARKETING_FORM_SCHEMA_VERSION,
    blocks,
    theme: theme ? mergeTheme(theme) : undefined,
  };
}

export function serializeDefinition(def: MarketingFormDefinition): MarketingFormDefinition {
  return {
    version: MARKETING_FORM_SCHEMA_VERSION,
    blocks: def.blocks.map((b) => ({ ...b })),
    theme: def.theme ? mergeTheme(def.theme) : mergeTheme({}),
  };
}
