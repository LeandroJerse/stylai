# StylAI — Security and Privacy Operating Policies

Version: 1.0 — 2026-11-22. **APPROVED INTERNAL POLICY.**

Accountable operator and approver: Leandro (approved in this conversation on November 22, 2026). Contact supplied by the operator: stylaioficial@gmail.com. This proposal does not appoint a Data Protection Officer. Legal operating entity: STYLAI INOVA SIMPLES(I.S.), as declared by the operator on November 22, 2026. Alternate incident contact: leandrojerse@gmail.com. Effective date: November 22, 2026. Internal distribution: this repository security folder, available to the sole operator.

These are approved operating requirements, not a statement that every control is already implemented. Implementation evidence and exceptions are tracked separately in MATRIZ-TIKTOK.md. Outstanding controls remain tracked as implementation exceptions.

## 1. Information security program

Scope: StylAI workstations, source code, administrative accounts, application/API, job workers, databases, object storage, integrations, vendors and backups. One operator currently performs development; additional personnel must be onboarded under these controls before receiving access.

The accountable operator maintains the asset and vendor inventory, approves access, tracks security issues and coordinates incidents and privacy requests. Review these policies annually and after material architectural changes or incidents. Maintain dated acceptance, version history and internal distribution evidence. Complete an onboarding security review for every new operator, and an annual refresher covering phishing, secrets, personal data and incident reporting.

## 2. Endpoint and network protection

Keep supported Windows versions, anti-malware protection and real-time protection enabled. Review signature freshness and security alerts weekly and run a quick scan weekly, subject to documented operational exceptions. Review security updates weekly and track failures. Do not add broad Defender exclusions to bypass development issues.

Enable firewall protection on all network profiles, retain bounded blocked-traffic logs and review relevant alerts weekly. Unexpected exposure or suspicious activity triggers incident triage. Restrict local development services to loopback unless explicit LAN access is necessary; document the source, destination, port, owner and expiry for exceptions. Keep production separate from development using separate credentials, data stores and access boundaries. Containers alone do not demonstrate network isolation.

Use authenticated screen locking after at most ten minutes of inactivity and lock manually when leaving the workstation. Verify full-disk encryption before storing protected production data on an endpoint. Secure recovery material separately from the device and repository. Test recovery availability without publishing recovery keys.

## 3. Authentication and access control

Use individual accounts, unique passwords stored in a password manager and MFA on administrative services where supported. Do not share accounts, tokens or recovery codes with assistants or contractors. Document any provider lacking MFA and compensating restrictions. Record who grants and removes access, systems, roles and justification; review at least annually and whenever roles or integrations change. Remove unnecessary access promptly when a role ends.

Use least-privilege service accounts and separate development/production secrets. Store secrets only in approved server-side facilities; never in frontend code, repository history, URLs or logs. Rotate exposed credentials and evaluate affected sessions. Administrative audit evidence must not contain secret values.

## 4. Data inventory, classification and encryption

Classify: public product material with permitted use; internal documentation; confidential operational data; restricted personal images, account data, authorization tokens and recovery material. A public product image obtained through TikTok is still subject to the provider's Protected Data rules and permitted purposes.

For every data category record purpose, source, permissions, storage system, physical processing/storage country, remote-access country, recipients, retention, deletion method and owner. Do not infer vendor geography from the user's location. Do not infer AI-processing rights from API access.

Use TLS 1.2 or higher for protected data in transit and AES-128 or stronger, or equivalent verified managed encryption, at rest. Session token encryption does not establish encryption of photos, logs or backups. Protect encryption keys separately, restrict key access and document rotation/recovery. If RSA is used, require 2048 bits or stronger.

## 5. Vulnerability and change management

Review dependencies and security advisories before each release and weekly during active operations. Use static checks, targeted security tests and a vulnerability tracker. Record finding, evidence, severity rationale, affected version, owner, mitigation, due date and retest result. Do not label ordinary automated tests as a penetration test.

Approved internal targets: investigate active exploitation immediately; triage critical/high findings within one business day; contain critical exposure within 24 hours where feasible; remediate critical/high findings within 7 days, medium within 30 days and low within 90 days. Unmet targets require documented mitigation, risk acceptance and a revised deadline. These are internal targets, not statutory notification deadlines or proof of past performance.

Review changes affecting authentication, authorization, storage, network exposure, payment or privacy before release. Test with synthetic data where possible. Keep a rollback plan and verify the actual deployed configuration.

## 6. Incident response and notification

Report suspected incidents to stylaioficial@gmail.com; if that mailbox is compromised, use the designated alternate contact leandrojerse@gmail.com. On November 22, 2026, the operator confirmed that he can access this alternate mailbox and revoke a TikTok key/suspend the integration. These are operator declarations, not an observed recovery or revocation drill. The operator records detection time, source, affected systems and facts separately from assumptions, and preserves necessary evidence with restricted access.

Sequence: assess scope and urgency; contain affected access/services; revoke exposed tokens; investigate personal/protected data impact; determine applicable contractual and legal notification obligations; notify through verified official channels; remediate; test recovery; document lessons. Do not destroy evidence or restart unrelated systems as a default response.

For TikTok-related incidents, identify the app, market, data categories, known impact, containment and follow-up contact using Partner Center support and the designated reviewer/contractual channel. Record actual notification deadlines from applicable agreements and law rather than inventing a universal deadline. Communicate uncertainties and later updates. A breach-notification promise alone is not the incident response program.

Run a tabletop exercise before declaring this process operational, then annually. Use a fictional token leak with synthetic data; record participants, detection, containment decision, notification analysis, recovery checks and corrective actions. Do not report a simulated incident to TikTok as real.

## 7. Internal personal-data handling and requests

Collect only necessary account and voluntarily supplied photo data for the approved feature. Separate user photos from TikTok catalog/authorization data in the inventory. Confirm permitted use and appropriate user notice before transferring data to any image-generation provider. Do not reuse photos or Protected Data for unrelated training, advertising or evaluation without a separately established lawful and authorized basis.

Receive requests for access, correction, export, deletion and other applicable rights at stylaioficial@gmail.com. Record a minimal request ID, date, requested action and due date; verify identity proportionately without collecting unnecessary identity documents. Identify relevant systems, execute or explain justified limitations, confirm outcome and keep minimal evidence. Internal acknowledgement target: two business days; statutory/contractual response deadlines must be determined for the request and prevail where shorter.

Maintain an accurate public privacy notice separately from this internal policy. Describe the actual entity, contact, data, purposes, recipients, locations/transfers, retention, rights and safeguards. Review at least annually and before material changes. Do not publish payment/order/shipping claims for features outside the actual MVP.

## 8. Retention, revocation and deletion

Before handling live TikTok data, approve a retention schedule by data category that is no longer than necessary and complies with provider terms and applicable obligations. Before accepting pilot photos, define their retention and removal path. Blank deadlines are a launch blocker, not unlimited retention authorization.

On authorization withdrawal, disconnection or contract termination: stop new processing; revoke/remove relevant credentials; purge connection-scoped cache and stored records; account for media derivatives, logs and backups; document completion and any legally required, narrowly scoped retention. Test the process using synthetic data and verify it cannot delete another connection's records. A cache TTL alone does not implement end-to-end deletion.

Retain no raw tokens, signed media URLs or personal images in logs. Minimize access logs and restrict them. When a backup ages out, verify expiry; when restoring, replay applicable deletion records before allowing service access. Never claim immediate removal from all backups without supporting capability.

## 9. Backup and continuity

Before production, establish encrypted backups in a separate failure domain with restricted credentials, retention, recovery objectives and deletion handling. Approved operating baseline: daily backup, up to 30 days retention, recovery point objective 24 hours and recovery time objective 48 hours. Confirm implementation feasibility, provider terms and any stricter deletion obligations; these objectives are not current recovery guarantees.

Test restoration with synthetic data before production and quarterly thereafter. Record source, date, isolation, completeness, access restrictions, elapsed time and cleanup. Git covers source history, not the complete database or media inventory. A successful backup job does not prove restoration.

## 10. Vendors and processing locations

Maintain a vendor register with service, actual use, data categories, processing/backup locations, contractual terms, access, retention and deletion commitments. Validate Supabase hosting mode separately from local development; list Segmind/fal only according to actual enabled processing. Do not transmit user photos or TikTok images to a new vendor merely because an adapter exists.

Assess vendor changes before activation. Record subprocessors and cross-border transfers as applicable. Vendor certifications may support the vendor assessment but are not StylAI certifications.

## Approval record

- Approver: Leandro. Express approval of the presented decisions in this conversation on November 22, 2026; operational ownership accepted, no automatic DPO appointment.
- Effective date: November 22, 2026. Internal distribution: this repository, sole operator.
- Contact: stylaioficial@gmail.com (provided; MFA shown enabled in supplied account screenshots; exact account identifiers must be confirmed before external submission).
- Entity: STYLAI INOVA SIMPLES(I.S.). Alternate channel: leandrojerse@gmail.com.
- Retention proposal, backup objectives and remediation targets approved; implementation and provider-specific constraints remain tracked separately.
- Exceptions and controls not yet implemented: link MATRIZ-TIKTOK.md and current evidence.
- Public pre-registration privacy notice: https://stylai.shop/privacidade, correction approved and published on November 22, 2026. The app/TikTok notice remains a separate draft.

Approval adopts responsibilities and procedures; it does not turn unverified technical controls into completed controls.

## Verified implementation snapshot — November 22, 2026

Historical evidence snapshot; current implementation is consolidated in MATRIZ-TIKTOK.md. The policy is approved, but approval does not certify all controls.

- Endpoint: Defender and firewall protections previously verified locally. Automatic lock configured for 600 seconds; actual lock/unlock test and Windows patch status remain unverified.
- BitLocker: administrative read-only query at 12:18:32 BRT confirmed C: FullyEncrypted, 100%, ProtectionStatus On, XtsAes128. No recovery key was read. The operator reports saving the key to their Microsoft account; recovery availability was not independently tested.
- MFA: supplied screenshots show two Google account sessions and the Microsoft account with two-step verification enabled. The Google screenshots do not display account email addresses; confirm their mapping to the backup and StylAI mailboxes before attaching external evidence. The operator confirmed that the pending Microsoft SMS-method removal was intentional. Backup-code storage and other administrative services remain unverified.
- Backup: manual encrypted 7-Zip archive (~234 MiB), held in a private personal Google Drive folder authorized by the operator. Downloaded checksum matches the original. File and Git restoration, PostgreSQL and 99 Storage files were verified in isolation.
- Application recovery: 37 checks passed against the restored copy: authentication, private media, upload, local MediaPipe, catalog search, simulated job processing and persisted result, browser navigation and session reload. No paid provider call occurred. Measures, plans, Closet and Match remain unimplemented in this code snapshot; no claim of full production functionality is made.
- Daily scheduling, 30-day expiry, RPO/RTO guarantees, deletion replay on recovery and quarterly restore cadence are proposed, not implemented. The recovery used cached dependencies and a local model artifact; a clean-machine recovery has not been tested.
- Google Drive personal account use is an explicit current operating choice, not proof of approved business data-processing terms or verified storage geography.

Approval received on November 22, 2026. Technical exceptions remain open; approval does not certify implemented controls.


## Approved retention baseline and implementation exceptions

Photos and generated results: retain while needed for the requested feature, until user deletion or termination of purpose/account, subject to any stricter applicable obligation. Sanitized operational logs: 30 days. Backups: 30 days, with deletion replay before restored data is served. TikTok cache/token retention must be validated against its applicable terms before live use; policy approval does not establish permission or a specific provider retention period.

The daily backup implementation is being configured through Codex automation and the existing Drive connector. It depends on this workstation, Docker, account permissions and service availability. A missed run or lack of a recent verified upload is an operational exception requiring attention; it is not silently marked as successful. Recovery codes kept outside this workstation and a cold-machine recovery remain pending.

Implementation update, November 22, 2026: daily Codex automation at 19:00 America/Sao_Paulo is active, with scoped 30-day retention. First manual execution of the automated workflow was encrypted, uploaded as three parts, downloaded and fully integrity-tested. No expired files were present. Scheduled execution still depends on workstation, Docker, connector and Codex availability; the first scheduled trigger has not yet been observed. See ROTINA-BACKUP-DIARIO.md for operational exceptions.

