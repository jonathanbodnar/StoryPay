# Evolving schema & data without losing anyone's work

This is the playbook for changing anything that stores **user-entered data** —
guest lists, table/seating assignments, RSVPs, meal options, minisite content,
proposals, CRM, etc. The whole point: **iterate freely while never losing data
and never breaking a venue or couple who is already using the feature.**

> Core truth: **code is replaced every deploy; data is forever.** A guest list a
> bride typed in September is still there in June. Every change must be
> backward-compatible with data that already exists.

Stack context: Postgres (Supabase), numbered SQL files in `migrations/`, applied
in prod via a small Node `pg` script (see `scripts/tmp_apply_*.mjs` pattern),
plus app-layer sanitizers. Supabase has **Point-in-Time Recovery** — that's the
ultimate safety net before any risky data change.

---

## The one pattern to remember: expand → migrate → contract

Never rename or repurpose a column/table in place. Instead, in **separate
deploys**:

1. **Expand** — add the new column/table alongside the old. Old code ignores it.
2. **Migrate/backfill** — copy or compute data into the new shape; keep writing
   both (or the new one) so old + new coexist.
3. **Contract** — only after nothing reads the old thing, drop it (can be weeks
   later, or never).

We already did this: `225_wedding_hub_rename_expand.sql` added + backfilled the
new columns, then `226_wedding_hub_rename_contract.sql` dropped the old ones once
code stopped referencing them. Do this for every field change.

---

## The three kinds of change

| Change | Risk | How to do it safely |
|---|---|---|
| **Add** a column/table | ✅ Safe | Nullable, or `NOT NULL DEFAULT <constant>`. Old rows get the default. This is 99% of iterations. |
| **Change the shape** of a field (esp. JSONB) | ⚠️ Care | Tolerant reader: accept old **and** new shapes, normalize on read. New writes use the new shape; old rows upgrade when next saved. Optional one-time backfill. |
| **Remove / rename** | 🚫 Do last | Only after confirming nothing reads it. A rename = add-new + backfill + switch-reads + drop-old, across deploys. |

---

## Non-negotiable rules

- **Every field has a defined behavior when missing.** Our sanitizers
  (`sanitizeCoupleSiteLinks`, `sanitizeLeadLinkLinks`, guest validators) already
  default unknown/absent values — that's the *tolerant reader* pattern and it's
  what makes shape changes safe. Keep leaning on it.
- **Additive first.** Prefer a new column over changing an existing one.
- **Never in-place rename/drop** on a live table. Expand/contract instead.
- **Soft-delete destructive user actions.** e.g. guestbook `is_hidden` — the user
  "removes" but it's recoverable. Prefer this wherever a regret would hurt.
- **Choose FK delete behavior deliberately.** `wedding_guests.table_id … ON
  DELETE SET NULL` means deleting a table *un-seats* guests instead of deleting
  them. Use `CASCADE` only when the child truly can't exist without the parent.
- **Migrations are idempotent** (`IF [NOT] EXISTS`, `ADD COLUMN IF NOT EXISTS`)
  and end with `NOTIFY pgrst, 'reload schema';`.
- **Backfills are batched & resumable** — never one giant `UPDATE` that locks a
  table. Add indexes `CONCURRENTLY`.
- **Gate behavioral changes behind a flag** (like the Wedding Hub add-on flag) so
  you can roll out to new/opted-in users and roll back instantly.
- **Test on the demo couple** (`thewestfolks@gmail.com`) before wide release.

---

## Structured columns vs JSONB — when to use which

- **Real columns** for anything you query, filter, join, count, or need
  referential integrity on (`party_size`, `table_id`, `rsvp_status`).
- **JSONB** for flexible, user-authored, shape-may-evolve lists (`meal_options`,
  `custom_links`, `visibility`). You can change the internal shape **without a
  migration** because the DB doesn't inspect it — your sanitizer owns validation
  and defaults. Promote a JSON field to a real column the moment you need to
  report/query across it.

---

## Worked example: today's table picker → future drag-and-drop room designer

**Today:** a guest is assigned via a simple dropdown; storage is one column
`wedding_guests.table_id` → `wedding_tables (id, name, capacity, sort_order)`.

**Future:** drag-and-drop a room — tables have positions, shapes, rotation; a
seat may map to a specific chair. How do we ship that without disturbing the
brides who already seated 200 guests the old way?

1. **Expand (additive migration).** Add optional columns; old data is untouched:
   - `wedding_tables`: `pos_x float`, `pos_y float`, `shape text DEFAULT 'round'`,
     `rotation int DEFAULT 0` — all nullable/defaulted.
   - (If per-seat placement is needed later) a new `wedding_seats` table that
     references guest + table; absence of a seat row simply means "seated at the
     table, no specific chair."
2. **Tolerant reader.** The new room UI reads `pos_x/pos_y`; when they're `NULL`
   (every existing table), it **auto-lays-out** tables in a grid. So an old
   seating chart opens perfectly in the new designer with zero data loss — it
   just hasn't been hand-arranged yet.
3. **Migrate on use.** When the bride drags a table, we save its position. Data
   upgrades naturally, per interaction — no big-bang migration.
4. **Keep the old path working.** The dropdown assignment still writes
   `table_id`; the new designer writes `table_id` **plus** position. Both UIs
   read the same `table_id`, so the venue's headcount/rollup never changes.
5. **Contract (maybe never).** `table_id` stays — it's the source of truth for
   "who sits where." We only add positioning on top. Nothing needs dropping.

Result: existing brides keep their exact seating; new/returning brides get the
designer; the venue's BEO rollup is identical throughout. **No forced migration,
no reset, no confused venue owner.**

### The general recipe for any "we changed how X works" moment
- Keep the **data source of truth** stable (here: `table_id`). Add new capability
  as **extra optional fields**, not a replacement.
- If the interaction changes, make the new UI **degrade gracefully** on old data
  (sensible auto-defaults for missing new fields).
- Prefer **migrate-on-write** (upgrade a row when it's next touched) over a
  risky bulk rewrite.
- Only consider a one-time backfill once the new path is proven and you want to
  retire the old — and even then, batch it and keep a backup/PITR window.

---

## Is this a strain on the database?

Generally no, for our shape of data:
- `ADD COLUMN … DEFAULT <constant>` is **instant** in Postgres 11+ (no table
  rewrite). Avoid `DEFAULT <volatile function>` or `NOT NULL` without a default
  on large tables.
- Row counts are naturally bounded (a wedding has ~50–300 guests, a few tables) —
  this is nowhere near a performance concern.
- The real long-term cost is **schema clutter** (dead columns, half-finished
  migrations), not speed. Manage it by actually doing the *contract* step and
  keeping migrations clearly numbered + labeled.

---

## Checklist before any DB / data-shape change

- [ ] Is this additive? If not, can it be reframed as expand → contract?
- [ ] Do old rows still read correctly (tolerant reader + defaults)?
- [ ] Migration idempotent + `NOTIFY pgrst` at the end?
- [ ] Destructive user action → soft-delete or `ON DELETE SET NULL`?
- [ ] Backfill batched/resumable (if any)?
- [ ] Behavioral change gated behind a flag?
- [ ] Tested on the demo couple; PITR window in mind as a safety net?
- [ ] Told the user, in plain language, what could affect existing data and how
      we're protecting it.
