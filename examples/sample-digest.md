# AI & IT digest: 2026-11-04

Top of this edition:
- Patch: Relay Software Relay Remote Server (CVE-2099-10001)
- Patch: Keystone Agent (CVE-2099-10002)
- Update Keystone Agent for Windows to 6.2.1

## Security to act on

### P0: Relay Software Relay Remote Server (CVE-2099-10001)
- Relay Remote Server Authentication Bypass. Ranked P0 because: remote-access or RMM tool, EPSS 0.71.
- Required action, from CISA: Apply mitigations per vendor instructions or discontinue use of the product if mitigations are unavailable.
- Added to the Known Exploited Vulnerabilities catalog on 2026-11-03. [NVD entry](https://nvd.nist.gov/vuln/detail/CVE-2099-10001)

### P0: Keystone Agent (CVE-2099-10002)
- Keystone Agent Privilege Escalation. Ranked P0 because: on your stack, EPSS 0.04.
- Required action, from CISA: Apply mitigations per vendor instructions.
- Added to the Known Exploited Vulnerabilities catalog on 2026-11-02. [NVD entry](https://nvd.nist.gov/vuln/detail/CVE-2099-10002)

### P1: Tessera NAS (CVE-2099-10003)
- Tessera NAS OS Command Injection. Ranked P1 because: known ransomware use, EPSS 0.09.
- Required action, from CISA: Apply mitigations per vendor instructions.
- Added to the Known Exploited Vulnerabilities catalog on 2026-10-30. [NVD entry](https://nvd.nist.gov/vuln/detail/CVE-2099-10003)

Also new in KEV, lower priority: CVE-2099-10004 (Quillsoft Quill PDF Editor).

### Support ending soon

- Tessera OS 4.x: end of extended support on 2026-11-30. [lifecycle page](https://eol.example.org/tessera-os)
- Orbit Server 2019: end of support on 2027-01-12. [lifecycle page](https://eol.example.org/orbit-server)

## Act on

- **Update Keystone Agent for Windows to 6.2.1** Versions before 6.2.1 let a signed-in user gain SYSTEM rights through the update service (CVSS 8.8). Keystone reports limited exploitation and no workaround. The agent is on every managed Windows device, so push the update through your RMM this week. [Keystone Identity advisories](https://keystone-id.example.com/security/KSA-2026-014), official source.

## Changes clients will notice

- **Orbit Mail blocks password-only IMAP and POP from January 15, 2027** Mail clients must switch to OAuth. Old scanners and line-of-business apps that send mail with basic authentication will stop working. Run the Legacy sign-ins report for each client now and plan replacements before the cutoff. [Orbit Workspace updates](https://updates.orbit-workspace.example.com/2026/11/basic-auth-retirement), official source.
- **Proposed 72-hour incident reporting rule for small federal contractors** Contractors with fewer than 100 employees would report covered cyber incidents within 72 hours. Comments close December 22, 2026. Clients with federal contracts may need an incident response plan that meets the deadline. [Federal rules search (sample)](https://rules.example.gov/documents/2026-24117), official source.
- **Orbit Drive Business goes from $12.00 to $14.00 per user per month** The new monthly price starts February 1, 2027; annual commitments renew at the new price after that date. Update client quotes and renewal notices. [Orbit Workspace updates](https://updates.orbit-workspace.example.com/2026/11/drive-business-pricing), official source.

## Worth offering

- **Orbit Meet live captions are generally available** Captions in 12 languages are included in Business Standard and Business Plus, and admins turn them on per organizational unit. An easy accessibility win to switch on for clients who run meetings with customers. [Orbit Workspace updates](https://updates.orbit-workspace.example.com/2026/11/meet-live-captions-ga), official source.
- **Lumen Enterprise audit logs can be exported or sent to a SIEM** Admins can export 180 days of audit logs as CSV or stream them to a SIEM over HTTPS; it is generally available now. Clients with compliance requirements can now keep AI usage records with the rest of their logs. [Lumen AI changelog](https://lumen-ai.example.com/changelog/audit-log-export), official source.

## Good to know

- **Lumen Assistant can search Orbit Drive shared drives** The connector is in public preview for Team and Enterprise workspaces and follows each user's existing file permissions. Worth testing on an internal tenant before anyone pitches it. [Lumen AI changelog](https://lumen-ai.example.com/changelog/shared-drive-connectors), official source. (moved here: not generally available yet)
- **Forum reports of a Relay Remote Server flaw being exploited** Community posts say attackers are reaching help desk machines through Relay Remote Server. The vendor has not commented. Watch for a vendor advisory; the KEV section above already lists a Relay Remote Server entry. [IT Weekly Roundup](https://it-weekly.example.net/2026/11/relay-remote-exploited), unconfirmed. (moved here: not confirmed by the vendor yet)

## Held back for review

These items were fetched but their summaries failed a check, so only the original link is shown.

- [Higher usage limits on the Lumen Team plan](https://lumen-ai.example.com/changelog/team-usage-limits) (Lumen AI changelog): summary had numbers not in the source (500)

## Run health

- Sources: 6 feeds checked, 1 failed.
  - Harbor Backup blog: GET https://harbor-backup.example.com/blog/rss.xml -> 500
- Model: claude-sonnet-5-5, 1 call, $0.0132 this run, $0.01 of $5.00 this month.
- Skipped as not relevant: 2. Waiting for the next run: 0.
