-- Embed form customisation: venue owners can set a custom title and button
-- label for the embeddable lead-capture / pricing-guide form.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS embed_form_title    TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS embed_form_btn_label TEXT DEFAULT NULL;
