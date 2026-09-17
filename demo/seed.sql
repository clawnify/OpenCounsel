-- Demo data for an isolated workspace. Fictional parties and text only.
--
-- Two matters: an NDA diligence set with a finished review, and a lease
-- renewal with no review yet. The page text exercises the citation check: the
-- "answered" quotes are present in it and the "rejected" one is absent.
-- Seeded documents carry text only; the embedded app shows the cited page
-- instead of opening the stored file, which a demo does not have.

insert into matters (id, name, client, description) values
  ('11111111-1111-4111-8111-111111111111', 'Project Aurora — NDAs', 'Northstar Biotech', 'Confidentiality agreements collected for the Aurora diligence.'),
  ('22222222-2222-4222-8222-222222222222', 'Harbour Street lease renewal', 'Kestrel Coffee Co.', 'Renewal of the ground-floor retail lease. No review started yet.');

insert into documents (id, matter_id, name, r2_key, mime, size_bytes, page_count, locator_kind, extract_status) values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Project Aurora - Mutual NDA.pdf',        'documents/seed/a', 'application/pdf', 84213, 2, 'page', 'ready'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'Redwood Capital - NDA (Executed).pdf',   'documents/seed/b', 'application/pdf', 91002, 2, 'page', 'ready'),
  ('cccccccc-3333-4333-8333-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'Meridian Labs - One-Way NDA.pdf',        'documents/seed/c', 'application/pdf', 66540, 2, 'page', 'ready'),
  ('dddddddd-4444-4444-8444-dddddddddddd', '22222222-2222-4222-8222-222222222222', 'Harbour Street - Lease Renewal.pdf',     'documents/seed/d', 'application/pdf', 52310, 1, 'page', 'ready');

insert into document_pages (document_id, page_no, text) values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 1,
   'MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is entered into as of 1 March 2026 between Northstar Biotech Ltd
and Aurora Therapeutics Inc (each a "Party").

1. Confidential Information. Each Party may disclose to the other certain
confidential and proprietary information. The obligations in this Agreement are
mutual and apply equally to each Party as Discloser and as Recipient.'),
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 2,
   '4. Governing Law. This Agreement shall be governed by and construed in
accordance with the laws of the State of New York, without regard to its
conflict of laws principles.

5. Term. The obligations of confidentiality shall survive for a period of three
(3) years from the Effective Date.'),

  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 1,
   'MUTUAL CONFIDENTIALITY AGREEMENT

Between Redwood Capital Partners LLP and Northstar Biotech Ltd. Each Party
acknowledges that it may receive Confidential Information from the other, and
the restrictions set out below bind both Parties reciprocally.'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 2,
   '7. Governing Law and Jurisdiction. This Agreement and any dispute arising out
of it shall be governed by the laws of England and Wales.

8. Duration. The confidentiality obligations shall continue for five (5) years
following the date of disclosure.'),

  ('cccccccc-3333-4333-8333-cccccccccccc', 1,
   'ONE-WAY NON-DISCLOSURE AGREEMENT

Meridian Labs GmbH ("Discloser") will disclose Confidential Information to
Northstar Biotech Ltd ("Recipient"). The obligations under this Agreement are
undertaken by the Recipient only.'),
  ('cccccccc-3333-4333-8333-cccccccccccc', 2,
   '6. Term. The Recipient shall keep the Confidential Information confidential
for so long as it remains a trade secret under applicable law.'),

  ('dddddddd-4444-4444-8444-dddddddddddd', 1,
   'LEASE RENEWAL AGREEMENT

Harbour Street Properties Ltd ("Landlord") and Kestrel Coffee Co. ("Tenant")
agree to renew the lease of Unit 2, 14 Harbour Street, for a further term of
five (5) years commencing 1 October 2026.

2. Rent. The annual rent shall be 38,500 EUR, payable quarterly in advance and
reviewed on the third anniversary of the renewal date.

3. Break Clause. The Tenant may terminate this lease on the third anniversary
by giving not less than six (6) months written notice.');

insert into reviews (id, matter_id, name, status) values
  ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', 'NDA review — round 1', 'complete');

insert into review_columns (id, review_id, position, key, question, type) values
  ('c0000001-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999', 0, 'direction',     'Is the NDA mutual or one-way?', 'text'),
  ('c0000002-0000-4000-8000-000000000002', '99999999-9999-4999-8999-999999999999', 1, 'governing_law', 'What is the governing law?',    'text'),
  ('c0000003-0000-4000-8000-000000000003', '99999999-9999-4999-8999-999999999999', 2, 'term',          'How long do confidentiality obligations survive?', 'text');

insert into review_cells (id, review_id, document_id, column_id, value, quote, page_no, status, rejected_reason) values
  -- Verified answers.
  ('e0000001-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'c0000001-0000-4000-8000-000000000001',
   'Mutual', 'The obligations in this Agreement are mutual and apply equally to each Party', 1, 'answered', ''),
  ('e0000002-0000-4000-8000-000000000002', '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'c0000002-0000-4000-8000-000000000002',
   'New York', 'governed by and construed in accordance with the laws of the State of New York', 2, 'answered', ''),
  ('e0000003-0000-4000-8000-000000000003', '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'c0000003-0000-4000-8000-000000000003',
   '3 years from the Effective Date', 'survive for a period of three (3) years from the Effective Date', 2, 'answered', ''),

  ('e0000004-0000-4000-8000-000000000004', '99999999-9999-4999-8999-999999999999', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'c0000001-0000-4000-8000-000000000001',
   'Mutual', 'the restrictions set out below bind both Parties reciprocally', 1, 'answered', ''),
  ('e0000005-0000-4000-8000-000000000005', '99999999-9999-4999-8999-999999999999', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'c0000002-0000-4000-8000-000000000002',
   'England and Wales', 'shall be governed by the laws of England and Wales', 2, 'answered', ''),

  -- The failure this app exists to catch: a fluent answer whose quote is not in
  -- the document. "five (5) years from the Effective Date" never appears —
  -- Redwood's clause runs from the date of disclosure, not the Effective Date.
  ('e0000006-0000-4000-8000-000000000006', '99999999-9999-4999-8999-999999999999', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'c0000003-0000-4000-8000-000000000003',
   '5 years from the Effective Date', 'shall survive for a period of five (5) years from the Effective Date', 2, 'rejected',
   'quote does not appear anywhere in this document''s extracted text'),

  ('e0000007-0000-4000-8000-000000000007', '99999999-9999-4999-8999-999999999999', 'cccccccc-3333-4333-8333-cccccccccccc', 'c0000001-0000-4000-8000-000000000001',
   'One-way', 'The obligations under this Agreement are undertaken by the Recipient only', 1, 'answered', ''),

  -- The honest answer: this NDA has no governing-law clause at all.
  ('e0000008-0000-4000-8000-000000000008', '99999999-9999-4999-8999-999999999999', 'cccccccc-3333-4333-8333-cccccccccccc', 'c0000002-0000-4000-8000-000000000002',
   '', '', null, 'not_found', ''),

  ('e0000009-0000-4000-8000-000000000009', '99999999-9999-4999-8999-999999999999', 'cccccccc-3333-4333-8333-cccccccccccc', 'c0000003-0000-4000-8000-000000000003',
   'Indefinite, while it remains a trade secret', 'for so long as it remains a trade secret under applicable law', 2, 'answered', '');

insert into workflows (id, name, description, columns_json) values
  ('f0000001-0000-4000-8000-000000000001', 'NDA review', 'Direction, governing law and survival period.',
   '[{"key":"direction","question":"Is the NDA mutual or one-way?","type":"text"},{"key":"governing_law","question":"What is the governing law?","type":"text"},{"key":"term","question":"How long do confidentiality obligations survive?","type":"text"}]');
