# Open product decisions

These decisions remain explicit configuration or TODOs because the source specifications mark them as proposed or pilot-dependent.

| Decision | Current safe development value | Production action |
| --- | --- | --- |
| OTP provider | Development adapter; `123456` outside production | Select provider, sender identity, abuse limits and residency |
| Access token lifetime | 10 minutes | Confirm within documented 5–15 minute range after threat review |
| File limits | 20 MB, five PDF/JPEG/PNG files | Validate on pilot devices and networks |
| Result release | Student-private files required | Confirm whether safe class-public results and two-person approval are enabled |
| Dual guardians | `ANY_GUARDIAN` aggregate follow-up | School chooses any vs all; individual evidence is always retained |
| Late and leave reporting | Stored as distinct statuses | School defines whether each counts as present |
| Attendance edit window | Same day in development | School defines window and escalation |
| Offline attachment download | Disabled | School/privacy owner decides whether explicit encrypted downloads are allowed |
| Scheduled announcements | Disabled | Enable only if pilot requires scheduling/quiet hours |
| Hosting region | Not selected | Confirm residency, vendors and contracts |
| Retention | No destructive production policy | Legal/school owners approve per-record retention and deletion schedule |
| RPO/RTO | 15 minutes / 1 hour proposed | Validate against hosting architecture and pilot agreement |
| RTL | Layout-safe foundation only | Prioritize/localize when required by pilot |
