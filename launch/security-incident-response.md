# Security Incident Response Runbook

This runbook covers suspected API key exposure, evidence leakage and alert-channel secret exposure during beta and launch operations.

## Severity

- `SEV-1`: API key ciphertext, plaintext key material, session tokens or alert secrets may have been exposed outside the authorized workspace boundary.
- `SEV-2`: Redaction failure in evidence, logs or public pages may expose request details, response excerpts or endpoint identifiers.
- `SEV-3`: Suspicious audit traffic, abuse reports or processor delivery failures require investigation but no secret exposure is confirmed.

## API Key Exposure Procedure

1. Disable the affected audit path immediately by pausing the provider node, stopping queued jobs for the workspace and disabling related alert channels if needed.
2. Notify affected users to rotate keys. Include the workspace, node name, approximate time window and rotation instructions, but do not echo any key material.
3. Inspect structured logs, error reports, database rows, evidence packages, exported reports, email webhook payloads and object storage processors for matching key fragments or authorization headers.
4. Publish an initial incident note within 24 hours for affected users. The note must include impact, containment, evidence reviewed, current status and next update time.
5. Evaluate legal, contractual and regulatory notification duties for the affected market before closing the incident.

## Evidence Handling

- Preserve redacted audit logs, job IDs, run IDs, affected workspace IDs and processor delivery IDs for the incident timeline.
- Do not copy plaintext secrets into tickets, chat, email or public updates.
- If any raw key fragment is found, treat the key as compromised and recommend immediate rotation.

## Closure Criteria

- Affected audit jobs are paused or confirmed safe.
- User notification has been sent when secret exposure cannot be ruled out.
- Logs, database, evidence exports and outbound notifications have been checked.
- The 24-hour initial note has been sent or a written reason exists for why user notice was not required.
- Follow-up prevention work is filed in Beads before closure.

