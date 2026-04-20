-- Catalog items venues can add to proposals/invoices (optional sync to LunarPay when API supports it).

CREATE TABLE IF NOT EXISTS public.venue_products (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                 uuid        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name                     text        NOT NULL,
  description              text,
  price                    int         NOT NULL CHECK (price >= 0),
  unit                     text        NOT NULL DEFAULT 'item',
  recurrence               text        NOT NULL DEFAULT 'one_time'
    CHECK (recurrence IN ('one_time', 'monthly', 'weekly')),
  inventory_mode           text        NOT NULL DEFAULT 'unlimited'
    CHECK (inventory_mode IN ('unlimited', 'limited')),
  inventory_quantity       int         CHECK (inventory_quantity IS NULL OR inventory_quantity >= 0),
  show_on_customer_portal  boolean     NOT NULL DEFAULT false,
  lunarpay_product_id      text,
  active                   boolean     NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_products_venue_id_idx ON public.venue_products (venue_id);
CREATE INDEX IF NOT EXISTS venue_products_venue_active_idx ON public.venue_products (venue_id, active);

COMMENT ON TABLE public.venue_products IS 'Venue catalog for payments/new and invoices; price is cents. lunarpay_product_id set when merchant product API accepts create.';
COMMENT ON COLUMN public.venue_products.price IS 'USD cents.';

ALTER TABLE public.venue_products DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_products TO service_role;

NOTIFY pgrst, 'reload schema';
