# Privacy Policy

Effective 2026-09-07. Astra Matrix, Inc. ("VYBZ") operates vybz.cloud and the VYBZ API. This policy explains what we collect, why, where it goes, and the choices you have.

## What we collect

| Category | Examples | Why | Legal basis |
|---|---|---|---|
| Account | Email, password hash, passkey credential ids | Sign-in and account recovery | Contract |
| Organization | Name, slug, plan, members, roles | Access control and billing | Contract |
| API activity | Method, path, status, latency, bytes, user agent, request id, key id | Security, audit, billing, support | Contract, legitimate interest in security |
| Customer content | Audio originals, issued copies, project files, commit metadata, recipient identifiers you supply | Providing the Service | Contract, on your instructions |
| Billing | Plan, subscription status, Paddle customer and subscription ids, invoice references, usage totals | Payment and plan enforcement | Contract |
| Support | Emails you send us and the request ids in them | Answering you | Legitimate interest |
| Site analytics | Aggregated page views without cookies or cross-site identifiers | Improving the site | Legitimate interest |

We do not sell personal data, do not share it for cross-context behavioral advertising, and do not use customer content to train models.

## Payments

Paid plans are sold by Paddle, our merchant of record. When you subscribe, Paddle collects your billing name, address, email, payment method, and tax status directly, in its own checkout, and acts as an independent controller of that data under [Paddle's privacy policy](https://www.paddle.com/legal/privacy). VYBZ receives only the customer and subscription identifiers, the subscription status, and invoice references. We never receive full payment card details.

## Recipient identifiers

When you issue a watermarked copy you supply a recipient identifier (often an email). It is stored with the issuance so the copy can be attributed. You are the controller of that data; treat it under your own privacy obligations, including telling recipients where the law requires it.

## Where data lives

| Provider | What | Location |
|---|---|---|
| Supabase | Database, authentication, object storage | United States (us-west-1) |
| Vercel | Site and hosted MCP endpoint | United States, edge network |
| Fly.io | Audio decoding and Content Credentials signing workers | United States (San Jose). Files are processed in memory and temporary storage and deleted after each request. |
| Paddle | Payments, invoices, tax | United Kingdom and United States |
| Resend | Transactional email | United States |

Enterprise customers may request another region for the database and storage.

## Retention

Account and organization records for the life of the account plus 30 days. Audit logs 13 months. Customer content until you delete it or close the organization, then 30 days. Billing records for as long as tax law requires, which Paddle holds as merchant of record. Backups roll off within 30 days.

## Your rights

You can access, correct, export, and delete your data from the console or by emailing privacy@vybz.cloud. We answer within 30 days. Residents of the EU, UK, Switzerland, California, and other jurisdictions with privacy laws have additional rights, including to object to processing, to restrict it, to data portability, and to lodge a complaint with a supervisory authority. We do not discriminate against you for exercising them. For business customers the [Data Processing Addendum](/legal/dpa) applies, including the Standard Contractual Clauses for international transfers.

## Security

Encryption in transit and at rest, hashed API keys, organization-scoped row-level security, private storage with signed URLs, and a complete audit log. See the [Security documentation](/docs/security) for detail. If a breach affects your personal data we will notify you without undue delay.

## Cookies

The site uses a session cookie for sign-in and local storage for console preferences. Paddle's checkout sets its own cookies inside the checkout window for fraud prevention and to complete the payment. There are no advertising cookies, so there is no cookie banner to dismiss.

## Children

The Service is for businesses and professionals and is not directed to anyone under 18. We do not knowingly collect their data.

## Changes

We will post changes here with a new effective date and, for material changes, email organization owners at least 14 days before they take effect.

Contact: privacy@vybz.cloud. Astra Matrix, Inc., Delaware, United States.
