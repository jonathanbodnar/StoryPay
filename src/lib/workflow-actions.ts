/**
 * Workflow Action Catalog
 * ───────────────────────
 * Single source of truth for what step kinds the workflow builder offers.
 * Categories drive the palette grouping in the right rail.
 */

export type WorkflowStepKind =
  | 'delay'
  | 'send_email'
  | 'send_sms'
  | 'add_tag'
  | 'remove_tag'
  | 'change_stage'
  | 'create_conversation'
  | 'notify_owner';

export type WorkflowActionCategory = 'timing' | 'communication' | 'contact' | 'alerts';

export const WORKFLOW_ACTION_CATEGORIES: { id: WorkflowActionCategory; label: string }[] = [
  { id: 'timing',        label: 'Timing' },
  { id: 'communication', label: 'Communication' },
  { id: 'contact',       label: 'Contact' },
  { id: 'alerts',        label: 'Internal Alerts' },
];

export interface WorkflowActionMeta {
  type: WorkflowStepKind;
  label: string;
  description: string;
  category: WorkflowActionCategory;
  iconName: 'clock' | 'mail' | 'phone' | 'tag-add' | 'tag-remove' | 'stage' | 'conv' | 'bell';
}

export const WORKFLOW_ACTIONS: WorkflowActionMeta[] = [
  {
    type:        'delay',
    label:       'Wait',
    description: 'Pause the workflow for a duration.',
    category:    'timing',
    iconName:    'clock',
  },
  {
    type:        'send_email',
    label:       'Send Email',
    description: 'Send a saved marketing email template.',
    category:    'communication',
    iconName:    'mail',
  },
  {
    type:        'send_sms',
    label:       'Send SMS',
    description: 'Send a text message — supports merge variables.',
    category:    'communication',
    iconName:    'phone',
  },
  {
    type:        'add_tag',
    label:       'Add Tag',
    description: 'Apply one or more tags to the contact.',
    category:    'contact',
    iconName:    'tag-add',
  },
  {
    type:        'remove_tag',
    label:       'Remove Tag',
    description: 'Remove one or more tags from the contact.',
    category:    'contact',
    iconName:    'tag-remove',
  },
  {
    type:        'change_stage',
    label:       'Change Stage',
    description: 'Move the contact to a pipeline stage.',
    category:    'contact',
    iconName:    'stage',
  },
  {
    type:        'create_conversation',
    label:       'Open Conversation',
    description: 'Start a conversation thread for this contact.',
    category:    'contact',
    iconName:    'conv',
  },
  {
    type:        'notify_owner',
    label:       'Notify Venue Owner',
    description: 'Send an email and/or SMS alert to the venue owner.',
    category:    'alerts',
    iconName:    'bell',
  },
];
