-- Remove helper searches (brand mentions, backlink hunts) that were saved as if they were keywords.
-- Run once in the Supabase SQL editor (or: supabase db push).
delete from public.serp_positions
 where keyword ~* '(^|\s)-?(site|intext|inurl|intitle|allintext|allinurl|allintitle|filetype|ext|related|cache|link|info|define):'
    or keyword ~ '"'
    or keyword ~ '(^|\s)-[a-z0-9]';

delete from public.keyword_universe
 where keyword ~* '(^|\s)-?(site|intext|inurl|intitle|allintext|allinurl|allintitle|filetype|ext|related|cache|link|info|define):'
    or keyword ~ '"'
    or keyword ~ '(^|\s)-[a-z0-9]';

delete from public.keyword_bank
 where keyword ~* '(^|\s)-?(site|intext|inurl|intitle|allintext|allinurl|allintitle|filetype|ext|related|cache|link|info|define):'
    or keyword ~ '"'
    or keyword ~ '(^|\s)-[a-z0-9]';