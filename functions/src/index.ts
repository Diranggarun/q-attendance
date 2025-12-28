import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';

admin.initializeApp();
const db = admin.firestore();

type UploadRequest = {
  fileBase64?: string;
  fileName?: string;
  ownerKey?: string;
};

function parseBufferToJson(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return json as Array<Record<string, any>>;
}

function normalizeRowToUser(row: Record<string, any>, ownerKey?: string) {
  const keys = Object.keys(row);
  // attempt to find candidate fields
  const emailKey = keys.find(k => k.toLowerCase().includes('email')) || 'email';
  const nameKey = keys.find(k => k.toLowerCase().includes('name')) || 'fullName';
  const roleKey = keys.find(k => k.toLowerCase().includes('role')) || 'role';
  const statusKey = keys.find(k => k.toLowerCase().includes('status')) || 'status';

  const user: any = {
    ownerKey: ownerKey || '',
    fullName: (row[nameKey] || row['fullName'] || '').toString().trim(),
    email: (row[emailKey] || row['email'] || '').toString().trim(),
    role: (row[roleKey] || 'student').toString().trim() || 'student',
    status: (row[statusKey] || 'active').toString().trim() || 'active'
  };
  return user;
}

export const uploadUsers = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send({ error: 'Method not allowed' });
    return;
  }

  const body = req.body as UploadRequest;
  if (!body || !body.fileBase64) {
    res.status(400).send({ error: 'fileBase64 is required' });
    return;
  }

  try {
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const rows = parseBufferToJson(buffer);

    if (!rows.length) {
      res.status(200).send({ success: 0, failed: 0, errors: [], message: 'No rows found' });
      return;
    }

    // Normalize rows
    const users = rows.map(r => normalizeRowToUser(r, body.ownerKey));

    // Detect duplicates within upload
    const emailCount = new Map<string, number>();
    for (const u of users) {
      if (!u.email) continue;
      emailCount.set(u.email, (emailCount.get(u.email) || 0) + 1);
    }
    const duplicatesInUpload = Array.from(emailCount.entries()).filter(([, c]) => c > 1).map(([e]) => e);

    // Check existing firestore (by email and ownerKey if provided)
    const duplicateEmails: string[] = [];
    for (const u of users) {
      if (!u.email) continue;
      const qSnap = await db.collection('users')
        .where('email', '==', u.email)
        .where('ownerKey', '==', u.ownerKey || '')
        .get();
      if (!qSnap.empty) duplicateEmails.push(u.email);
    }

    // Filter valid users (must have email)
    const validUsers = users.filter(u => u.email && (!duplicateEmails.includes(u.email)));

    const batch = db.batch();
    const errors: Array<{ row: any; error: string }> = [];
    let successCount = 0;

    for (const u of validUsers) {
      try {
        const ref = db.collection('users').doc();
        const toSave = { ...u, key: ref.id };
        batch.set(ref, toSave);
        successCount++;
      } catch (e) {
        errors.push({ row: u, error: (e as Error).message });
      }
    }

    if (successCount > 0) await batch.commit();

    res.status(200).send({
      success: successCount,
      failed: rows.length - successCount,
      errors,
      duplicateEmails: Array.from(new Set([...duplicateEmails, ...duplicatesInUpload]))
    });
  } catch (e) {
    console.error('uploadUsers error', e);
    res.status(500).send({ error: (e as Error).message || String(e) });
  }
});
