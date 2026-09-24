-- Migration 254: LeadFinder™ inbound-email provenance.
--
-- Every message that arrives at a venue's LeadFinder address gets a row here
-- BEFORE any processing happens, so nothing can be lost to a webhook retry, an
-- AI timeout, or a parser crash: the raw arrival is on disk and the row carries
-- its own status, which makes reprocessing possible.
--
-- Purely additive — a new table, no existing table touched. Nothing reads it
-- until the LeadFinder ingest path ships behind its flag.

CREATE TABLE IF NOT EXISTS public.leadfinder_imports (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                  uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,

  -- Envelope. These are the headers reply routing and dedupe depend on, stored
  -- now even though V1 does not reply, so a later phase needs no migration.
  sender                    text,
  sender_domain             text,
  reply_to                  text,
  original_message_id       text,
  in_reply_to               text,
  email_references          text,
  subject                   text,
  received_at               timestamptz,

  -- Classification and extraction.
  detected_source           text,
  parser_version            text,
  extraction_source         text        CHECK (extraction_source IS NULL OR extraction_source IN ('deterministic', 'ai')),
  classification_confidence numeric,
  extraction_confidence     numeric,

  -- Body is kept so a parse can be replayed and so the venue can read the
  -- original. HTML is stored by reference only (bucket object path), never
  -- inline, because marketplace HTML is large and untrusted.
  raw_text                  text,
  raw_html_ref              text,

  processing_status         text        NOT NULL DEFAULT 'pending'
                                        CHECK (processing_status IN ('pending','processed','skipped','failed')),
  failure_reason            text,

  -- The lead this message produced or updated. SET NULL rather than CASCADE:
  -- deleting a lead must not erase the record that the email ever arrived.
  lead_id                   uuid        REFERENCES public.leads(id) ON DELETE SET NULL,

  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Idempotency at the database level: the same Message-ID for the same venue can
-- only ever be imported once, so a duplicate webhook delivery cannot create a
-- second lead even if the application check is bypassed by a race.
-- Partial, because a missing Message-ID must still be storable.
CREATE UNIQUE INDEX IF NOT EXISTS leadfinder_imports_message_id_key
  ON public.leadfinder_imports (venue_id, original_message_id)
  WHERE original_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leadfinder_imports_venue_received_idx
  ON public.leadfinder_imports (venue_id, received_at DESC);

CREATE INDEX IF NOT EXISTS leadfinder_imports_source_idx
  ON public.leadfinder_imports (detected_source);

-- Health queries look for stuck rows.
CREATE INDEX IF NOT EXISTS leadfinder_imports_status_idx
  ON public.leadfinder_imports (processing_status)
  WHERE processing_status <> 'processed';

NOTIFY pgrst, 'reload schema';
