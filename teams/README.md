# Teams Integration

This directory contains the Microsoft Teams app manifest and Adaptive Card templates for the Global Change Governance & Impact Management Platform.

## Uploading the Manifest to Teams Developer Portal

1. Go to https://dev.teams.microsoft.com and sign in.
2. Select **Apps** > **Import app**.
3. Zip the contents of this directory (manifest.json + icon files) into a single `.zip`.
4. Upload the zip. Fix any validation errors reported by the portal.
5. Publish to your organisation's app catalogue or side-load for testing.

## Icon Requirements

| File | Size | Format | Purpose |
|------|------|--------|---------|
| `icon-color.png` | 192 x 192 px | PNG, 32-bit RGBA | Full-colour app icon shown in the app catalogue |
| `icon-outline.png` | 32 x 32 px | PNG, transparent background | Monochrome outline icon used in the Teams sidebar |

Replace the placeholder files with correctly-sized PNGs before uploading to Teams.

## Adaptive Card Templates

The `adaptive-cards/` directory contains Power Automate-compatible Adaptive Card templates:

### approval.json
Sent to approvers when a change requires sign-off. Variables (prefixed `${}`):
- `changeNumber` — e.g. CHG-0042
- `title` — change title
- `riskLevel` — Low / Medium / High / Critical
- `startTime` — ISO 8601 datetime string
- `requestedBy` — display name of the requester
- `description` — change description
- `changeId` — Dataverse record GUID
- `deepLinkUrl` — direct link back to the app

### rejection.json
Sent to the requester when a change is rejected. Variables:
- `changeNumber`
- `rejectedBy` — display name of the reviewer
- `rejectionReason` — free-text reason
- `deepLinkUrl`

## Wiring Adaptive Cards in Power Automate

1. Create a cloud flow triggered by a Dataverse row update (change status transition).
2. Add a **Post adaptive card and wait for a response** action (Teams connector).
3. Paste the JSON from the template file, replacing `${}` placeholders with dynamic content from the trigger.
4. Branch on the response `action` field: `approve` → update change status to Released; `reject` → update to Cancelled and send rejection card.
