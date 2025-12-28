# Cloud Functions — q-attendance

This folder contains Firebase Cloud Functions for q-attendance.

Function added:

- `uploadUsers` — HTTP POST endpoint that accepts JSON payload with properties:
  - `fileBase64` (required): base64-encoded contents of the spreadsheet (.csv/.xlsx)
  - `fileName` (optional): original file name
  - `ownerKey` (optional): owner id to attach to created users

The function will parse rows using xlsx, normalize columns into user fields (fullName, email, role, status, ownerKey), detect duplicates, and batch-insert new user documents into `users` collection.

Deploy locally with the Firebase emulator or deploy with `firebase deploy --only functions` from the `functions` folder.

Example usage (curl):

```bash
curl -X POST https://REGION-PROJECT.cloudfunctions.net/uploadUsers \
  -H 'Content-Type: application/json' \
  --data '{"fileBase64": "<BASE64_CONTENT>", "fileName":"students.xlsx", "ownerKey":"teacher_owner_id" }'
```

When using the emulator replace the URL with the emulator-hosted URL (shown by the emulator UI).
