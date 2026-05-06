INSERT INTO entities (id, code, name, country, base_currency, default_credit_days)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'IND', 'India', 'IN', 'INR', NULL),
  ('22222222-2222-2222-2222-222222222222', 'UAE', 'United Arab Emirates', 'AE', 'AED', NULL)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  base_currency = EXCLUDED.base_currency;

INSERT INTO exception_bucket_types (id, code, name, description, active)
VALUES
  ('33333333-3333-3333-3333-333333333331', 'LEGAL_LITIGATION', 'Legal/litigation', 'Invoices pending legal or litigation resolution.', true),
  ('33333333-3333-3333-3333-333333333332', 'DISPUTED_BY_CLIENT', 'Disputed by client', 'Invoices disputed by the client.', true),
  ('33333333-3333-3333-3333-333333333333', 'CREDIT_NOTE_PENDING', 'Credit note pending', 'Invoices awaiting credit-note adjustment.', true),
  ('33333333-3333-3333-3333-333333333334', 'WRITTEN_OFF', 'Written-off', 'Invoices classified as written-off for dashboard purposes.', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = EXCLUDED.active;

INSERT INTO users (id, email, google_sub, name, role, is_active, last_login_at)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'tejaswa.sharma@emb.global',
  'stub-admin',
  'Tejaswa Sharma',
  'ADMIN',
  true,
  '2026-04-30T10:00:00Z'
)
ON CONFLICT (email) DO UPDATE SET
  google_sub = COALESCE(users.google_sub, EXCLUDED.google_sub),
  name = COALESCE(NULLIF(users.name, ''), EXCLUDED.name),
  role = 'ADMIN',
  is_active = true;

INSERT INTO parties_canonical (id, entity_id, name, notes, created_by)
VALUES
  ('55555555-5555-5555-5555-555555555551', '11111111-1111-1111-1111-111111111111', 'Cloud Nine Retail Pvt Ltd', 'Local demo party', (SELECT id FROM users WHERE email = 'tejaswa.sharma@emb.global')),
  ('55555555-5555-5555-5555-555555555552', '11111111-1111-1111-1111-111111111111', 'Omkar Agencies', 'Local demo party', (SELECT id FROM users WHERE email = 'tejaswa.sharma@emb.global')),
  ('55555555-5555-5555-5555-555555555553', '11111111-1111-1111-1111-111111111111', 'South Peak Traders', 'Local demo party', (SELECT id FROM users WHERE email = 'tejaswa.sharma@emb.global'))
ON CONFLICT (entity_id, name) DO UPDATE SET
  notes = EXCLUDED.notes;

INSERT INTO credit_period_config (id, canonical_id, days, reason_note, valid_from, updated_by)
SELECT id, canonical_id, days, reason_note, valid_from, updated_by
FROM (
  VALUES
    ('66666666-6666-6666-6666-666666666661'::uuid, '55555555-5555-5555-5555-555555555551'::uuid, 30, 'Local demo party-specific credit period', '2026-01-01'::date, (SELECT id::uuid FROM users WHERE email = 'tejaswa.sharma@emb.global')),
    ('66666666-6666-6666-6666-666666666662'::uuid, '55555555-5555-5555-5555-555555555552'::uuid, 45, 'Local demo party-specific credit period', '2026-01-01'::date, (SELECT id::uuid FROM users WHERE email = 'tejaswa.sharma@emb.global')),
    ('66666666-6666-6666-6666-666666666663'::uuid, '55555555-5555-5555-5555-555555555553'::uuid, 60, 'Local demo party-specific credit period', '2026-01-01'::date, (SELECT id::uuid FROM users WHERE email = 'tejaswa.sharma@emb.global'))
) AS seed(id, canonical_id, days, reason_note, valid_from, updated_by)
WHERE NOT EXISTS (
  SELECT 1
  FROM credit_period_config existing
  WHERE existing.canonical_id = seed.canonical_id AND existing.valid_to IS NULL
);

INSERT INTO snapshots (
  id,
  entity_id,
  uploaded_by,
  upload_file_path,
  upload_file_sha256,
  as_of_date,
  source_hint,
  status,
  row_count,
  total_outstanding,
  parse_result_json,
  published_as,
  published_at,
  published_by
)
VALUES (
  '77777777-7777-7777-7777-777777777771',
  '11111111-1111-1111-1111-111111111111',
  (SELECT id FROM users WHERE email = 'tejaswa.sharma@emb.global'),
  'local-demo-seed.xlsx',
  '1111111111111111111111111111111111111111111111111111111111111111',
  '2026-04-30',
  'TALLY',
  'PUBLISHED',
  5,
  700000.00,
  '{"source":"local_seed","rows":5}'::jsonb,
  'SELF',
  '2026-04-30T10:05:00Z',
  (SELECT id FROM users WHERE email = 'tejaswa.sharma@emb.global')
)
ON CONFLICT (upload_file_sha256) DO UPDATE SET
  status = 'PUBLISHED',
  as_of_date = EXCLUDED.as_of_date,
  total_outstanding = EXCLUDED.total_outstanding,
  row_count = EXCLUDED.row_count,
  published_at = EXCLUDED.published_at,
  published_by = EXCLUDED.published_by;

INSERT INTO invoices (
  id,
  entity_id,
  canonical_id,
  invoice_ref,
  invoice_date,
  amount,
  currency,
  credit_days_applied,
  credit_days_source,
  due_date,
  status,
  first_seen_snapshot_id,
  raw_row_json
)
VALUES
  ('88888888-8888-8888-8888-888888888881', '11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555551', 'IND-DEMO-1001', '2026-04-15', 125000.00, 'INR', 30, 'CONFIG', '2026-05-15', 'OPEN', '77777777-7777-7777-7777-777777777771', '{"source":"local_seed"}'::jsonb),
  ('88888888-8888-8888-8888-888888888882', '11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555551', 'IND-DEMO-1002', '2026-03-10', 87500.00, 'INR', 30, 'CONFIG', '2026-04-09', 'OPEN', '77777777-7777-7777-7777-777777777771', '{"source":"local_seed"}'::jsonb),
  ('88888888-8888-8888-8888-888888888883', '11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555552', 'IND-DEMO-1003', '2026-01-15', 210000.00, 'INR', 45, 'CONFIG', '2026-03-01', 'OPEN', '77777777-7777-7777-7777-777777777771', '{"source":"local_seed"}'::jsonb),
  ('88888888-8888-8888-8888-888888888884', '11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555553', 'IND-DEMO-1004', '2025-12-15', 152500.00, 'INR', 60, 'CONFIG', '2026-02-13', 'OPEN', '77777777-7777-7777-7777-777777777771', '{"source":"local_seed"}'::jsonb),
  ('88888888-8888-8888-8888-888888888885', '11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555552', 'IND-DEMO-1005', '2025-10-01', 125000.00, 'INR', 30, 'CONFIG', '2025-10-31', 'OPEN', '77777777-7777-7777-7777-777777777771', '{"source":"local_seed"}'::jsonb)
ON CONFLICT (entity_id, canonical_id, invoice_ref) DO UPDATE SET
  amount = EXCLUDED.amount,
  currency = EXCLUDED.currency,
  credit_days_applied = EXCLUDED.credit_days_applied,
  credit_days_source = EXCLUDED.credit_days_source,
  due_date = EXCLUDED.due_date,
  status = EXCLUDED.status,
  first_seen_snapshot_id = EXCLUDED.first_seen_snapshot_id,
  raw_row_json = EXCLUDED.raw_row_json;

INSERT INTO invoice_snapshots (snapshot_id, invoice_id, as_of_date, outstanding_amount, overdue_days, bucket)
SELECT seed.snapshot_id, seed.invoice_id, seed.as_of_date, seed.outstanding_amount, seed.overdue_days, seed.bucket
FROM (
  VALUES
    ('77777777-7777-7777-7777-777777777771'::uuid, '88888888-8888-8888-8888-888888888881'::uuid, '2026-04-30'::date, 125000.00, 0, 'NOT_DUE'),
    ('77777777-7777-7777-7777-777777777771'::uuid, '88888888-8888-8888-8888-888888888882'::uuid, '2026-04-30'::date, 87500.00, 21, '0_30'),
    ('77777777-7777-7777-7777-777777777771'::uuid, '88888888-8888-8888-8888-888888888883'::uuid, '2026-04-30'::date, 210000.00, 60, '31_60'),
    ('77777777-7777-7777-7777-777777777771'::uuid, '88888888-8888-8888-8888-888888888884'::uuid, '2026-04-30'::date, 152500.00, 76, '61_90'),
    ('77777777-7777-7777-7777-777777777771'::uuid, '88888888-8888-8888-8888-888888888885'::uuid, '2026-04-30'::date, 125000.00, 181, '90_PLUS')
) AS seed(snapshot_id, invoice_id, as_of_date, outstanding_amount, overdue_days, bucket)
WHERE NOT EXISTS (
  SELECT 1
  FROM invoice_snapshots existing
  WHERE
    existing.snapshot_id = seed.snapshot_id
    AND existing.invoice_id = seed.invoice_id
    AND existing.as_of_date = seed.as_of_date
);

INSERT INTO exception_tags (
  id,
  invoice_id,
  bucket_type_id,
  reason,
  tagged_by,
  tagged_at,
  expected_resolution_date,
  status
)
VALUES (
  '99999999-9999-9999-9999-999999999991',
  '88888888-8888-8888-8888-888888888884',
  '33333333-3333-3333-3333-333333333333',
  'Local demo credit note follow-up pending',
  (SELECT id FROM users WHERE email = 'tejaswa.sharma@emb.global'),
  '2026-04-28T09:00:00Z',
  '2026-05-07',
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE SET
  reason = EXCLUDED.reason,
  expected_resolution_date = EXCLUDED.expected_resolution_date,
  status = EXCLUDED.status;

INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, before, after)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  (SELECT id FROM users WHERE email = 'tejaswa.sharma@emb.global'),
  'local_seed.demo_snapshot',
  'snapshot',
  '77777777-7777-7777-7777-777777777771',
  NULL,
  '{"entity":"IND","as_of_date":"2026-04-30","invoices":5,"total_outstanding":"700000.00"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
