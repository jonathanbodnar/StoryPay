// Dynamic dropdown of existing tags (so users don't typo)
const listTags = (z) =>
  z.request({ url: '{{process.env.API_BASE}}/api/v1/tags' }).then((r) => r.data.tags || []);

const perform = (z, bundle) =>
  z
    .request({
      url: '{{process.env.API_BASE}}/api/v1/tags/apply',
      method: 'POST',
      body: {
        email: bundle.inputData.email,
        tag_id: bundle.inputData.tag_id || undefined,
        tag_name: bundle.inputData.tag_name || undefined,
      },
    })
    .then((r) => r.data);

module.exports = {
  key: 'add_tag',
  noun: 'Tag',
  display: {
    label: 'Add Tag to Contact',
    description:
      'Apply a tag to a contact (resolved by email). This will fire any Workflows triggered by tag_added — useful for "When tag X is added, do Y".',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'email', label: 'Contact email', required: true },
      {
        key: 'tag_id',
        label: 'Tag (existing)',
        required: false,
        dynamic: 'list_tags.id.name',
        helpText: 'Pick an existing tag, OR fill in the field below to create a new one.',
      },
      {
        key: 'tag_name',
        label: 'Tag name (creates new tag if it doesn\'t exist)',
        required: false,
        helpText: 'Use this OR the dropdown above. If the tag doesn\'t exist yet, it will be created automatically.',
      },
    ],
    sample: { success: true, lead_id: '00000000-0000-0000-0000-000000000000', tag: { id: '...', name: 'VIP' } },
  },
};

// Hidden trigger used to populate the dropdown above.
module.exports.dynamicTagsTrigger = {
  key: 'list_tags',
  noun: 'Tag',
  display: {
    label: 'List Tags',
    description: 'Internal — populates the tag dropdown.',
    hidden: true,
  },
  operation: { perform: listTags, sample: { id: 'tag_1', name: 'VIP' } },
};
