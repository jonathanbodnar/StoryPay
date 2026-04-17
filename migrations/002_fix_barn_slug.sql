-- One-off: fix the manually-typed slug for "The Barn at New Albany".
-- Safe to run multiple times — WHERE clause matches the exact current slug.
update public.venues
   set slug = 'the-barn-at-new-albany',
       updated_at = now()
 where id = '6ee45f1f-02d4-4b07-ac24-b4a33b1c55a0'
   and slug = 'thebarnatnewlbany';

select id, name, slug, is_published
  from public.venues
 where id = '6ee45f1f-02d4-4b07-ac24-b4a33b1c55a0';
