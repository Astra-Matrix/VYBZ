# Data Processing Addendum

Effective 2026-09-07. This addendum applies when Andrew Laustrup, doing business as VYBZ ("VYBZ", the processor) processes personal data on behalf of a customer (the controller) under the Terms of Service. It is incorporated into the Terms for every organization; no signature is required, and a countersigned copy is available on request.

## 1. Scope and roles

The customer is the controller of personal data contained in customer content and recipient identifiers. VYBZ is the processor and acts only on the customer's documented instructions, which are the Terms, the console configuration, and API calls. For account data of the customer's own users, and for billing data, VYBZ is an independent controller under the Privacy Policy.

## 2. Nature of processing

Storage, hashing, watermarking, signing, verification, correlation, transmission, and deletion of audio and project files; recording of API activity for audit and billing. Data subjects are the customer's staff, its recipients of issued copies, and any individuals identifiable in customer content. Processing lasts for the term of the agreement plus the deletion period.

## 3. Sub-processors

| Sub-processor | Purpose | Location | Data touched |
|---|---|---|---|
| Supabase, Inc. | Database, authentication, object storage | United States | All categories |
| Vercel, Inc. | Site hosting, hosted MCP endpoint | United States | Requests in transit |
| Fly.io, Inc. | Audio decoding and Content Credentials signing workers | United States | Audio files in transit; nothing retained after the request |
| Resend, Inc. | Transactional email | United States | Email addresses, invitation links |

Paddle (Paddle.com Market Limited, Paddle.com Inc.) is the merchant of record for payments and an independent controller of billing data rather than a sub-processor; it never receives customer content.

VYBZ will give 30 days' notice by email to organization owners before adding a sub-processor. The customer may object on reasonable data-protection grounds, and if the objection cannot be resolved may terminate the affected service without penalty.

## 4. Security

Technical and organizational measures include encryption in transit and at rest, hashed API credentials, organization-scoped row-level security, private storage with expiring signed URLs, least-privilege service roles, secrets held in a managed vault, and a complete audit log. Details are in the [Security documentation](/docs/security).

## 5. Confidentiality

Personnel with access to personal data are bound by confidentiality obligations and receive access only as needed.

## 6. Assistance

VYBZ will assist the customer with data-subject requests, security incident notifications (without undue delay and within 72 hours of confirmation), and impact assessments, to the extent the information is available to VYBZ.

## 7. Deletion and return

On termination, customer content is deleted within 30 days unless retention is legally required. The customer may export content through the API or console at any time before that.

## 8. Audits

VYBZ will provide reasonable information to demonstrate compliance and will permit audits by the customer or an independent auditor, on reasonable notice and no more than once per year unless required by a supervisory authority.

## 9. International transfers

Where personal data of EU, UK, or Swiss residents is transferred to the United States, the parties rely on the EU Standard Contractual Clauses (Module 2, controller to processor), the UK International Data Transfer Addendum, and the Swiss amendments, incorporated by reference. Annex details: the data and purposes in sections 1 and 2, the measures in section 4, the sub-processors in section 3.

## 10. Precedence

In a conflict between this addendum and the Terms regarding personal data, this addendum prevails.

Contact: privacy@vybz.cloud
