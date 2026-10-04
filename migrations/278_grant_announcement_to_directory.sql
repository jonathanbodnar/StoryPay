-- 278: the directory's venue pages also read venues.announcement (the
-- listing announcement bar, added after its original grant list). One
-- ungranted column fails the whole select, which kept /venues, venue pages
-- and search empty after 277 restored the rest. Same contract as 277:
-- tests/flows/locked-database.test.ts holds the exact column list.
grant select (announcement) on public.venues to anon, authenticated;
NOTIFY pgrst, 'reload schema';
