-- 275: "Update your card" links for Stripe payment plans.
-- card_update_tokens was made for LunarPay and required a LunarPay customer id.
-- Stripe plans have none, so every Stripe card-update link failed to save and
-- the emails fell back to the invoice page. The column is now optional.
ALTER TABLE public.card_update_tokens ALTER COLUMN customer_lunarpay_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
