<template>
  <q-dialog :model-value="modelValue" @update:model-value="(v) => emit('update:modelValue', v)" persistent>
    <q-card style="min-width: 480px;">
      <q-card-section>
        <div class="text-h6">Import Users</div>
      </q-card-section>

      <q-card-section>
        <div class="q-mb-sm">Select a CSV or Excel file (first row must be headers: e.g. fullName,email,role,status)</div>
        <input type="file" accept=".csv,.xlsx,.xls" @change="handleFileChange" />

        <div v-if="showColumnMapping && rawRows.length" class="q-mt-md">
          <div class="text-h6 q-mb-md">Map CSV/Excel Columns</div>
          <div class="q-mb-md">
            <div v-for="(val, key, idx) in columnMapping" :key="idx" class="q-mb-md">
              <div class="text-subtitle2">{{ key }} →</div>
              <q-select
                :model-value="val"
                :options="['fullName', 'email', 'role', 'status']"
                @update:model-value="(v) => (columnMapping[key] = v)"
                dense
                emit-value
              />
            </div>
          </div>
          <div class="row items-center justify-between">
            <q-btn
            color="primary"
            label="Continue to Preview"
              @click="continueToPreview"
          />
            <div v-if="previewOnly" class="text-caption q-ml-sm">Previewing first {{ PREVIEW_LIMIT }} rows only (large file). Use server import for full files.</div>
          </div>
        </div>

        <div v-if="duplicates.length" class="q-mt-md">
          <div class="text-warning text-h6">⚠ Duplicate Emails Detected</div>
          <q-list bordered class="q-mt-xs">
            <q-item v-for="(dup, idx) in duplicates" :key="idx">
              <q-item-section>
                <q-item-label>{{ dup.email }}</q-item-label>
                <q-item-label caption>Appears {{ dup.count }} times in this import</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
          <div class="q-mt-sm text-caption text-grey">Note: Importing duplicates may overwrite existing records</div>
        </div>

        <div v-if="isParsing" class="row items-center justify-center q-mt-md">
          <q-spinner color="primary" size="36px" />
          <div class="q-ml-sm">Parsing file, please wait...</div>
        </div>
        <div v-if="parsedUsers.length && !showColumnMapping" class="q-mt-md">
          <div class="row items-center justify-between q-mb-sm">
            <div>Preview ({{ parsedUsers.length }} users)</div>
            <div class="text-caption">Showing up to 100 rows</div>
          </div>
          <q-table
            dense
            flat
            :rows="parsedUsersPreview"
            :columns="previewColumns"
            :row-key="rowKey"
            :pagination="previewPagination"
          />
        </div>
        <div v-if="isImporting" class="q-mt-md">
          <div>Importing: {{ importProgress }} / {{ importTotal }}</div>
          <q-linear-progress :value="importTotal ? importProgress / importTotal : 0" color="primary" />
        </div>

        <div v-if="importErrors.length" class="q-mt-md">
          <div class="text-negative">Errors ({{ importErrors.length }})</div>
          <q-list bordered class="q-mt-xs">
            <q-item v-for="(err, idx) in importErrors" :key="idx">
              <q-item-section>
                <q-item-label>{{ err.user.fullName || err.user.email }}</q-item-label>
                <q-item-label caption>{{ err.error }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cancel" color="negative" @click="cancel" :disable="isImporting" />
        <q-btn
          color="primary"
          label="Confirm Import"
          :loading="isImporting"
          @click="confirmImport"
          :disable="parsedUsers.length === 0 || isImporting"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Notify } from 'quasar';
import { useUsersStore } from 'src/stores/user-store';
import type { UserModel } from 'src/models/user.models';

const props = defineProps<{ modelValue: boolean; ownerKey?: string }>();
const emit = defineEmits(['update:modelValue']);

const parsedUsers = ref<UserModel[]>([]);
const parsedUsersPreview = computed(() => parsedUsers.value.slice(0, 100));
const previewColumns = ref<Array<{ name: string; label: string; field: string }>>([]);
const rowKey = ref('email');
const previewPagination = ref({ page: 1, rowsPerPage: 10 });
const isImporting = ref(false);
const isParsing = ref(false);
const previewOnly = ref(false);
const PREVIEW_LIMIT = 100;
const importProgress = ref(0);
const importTotal = ref(0);
const importErrors = ref<Array<{ user: UserModel; error: string }>>([]);
const showColumnMapping = ref(false);
const columnMapping = ref<Record<string, string>>({});
const rawRows = ref<Array<Record<string, unknown>>>([]);
const duplicates = ref<Array<{ email: string; count: number }>>([]);
const userStore = useUsersStore();

async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  isParsing.value = true;
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  // Use xlsx for both Excel and CSV parsing. That avoids depending on PapaParse.
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const mod = await import('xlsx');
      const XLSX = mod as any;
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = wb.SheetNames && wb.SheetNames[0];
      if (!firstSheetName) {
        parsedUsers.value = [];
        return;
      }
      const sheet = wb.Sheets[firstSheetName];
      const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      rawRows.value = json as Array<Record<string, unknown>>;
        // If the file is large, we'll only preview the first PREVIEW_LIMIT rows to keep the UI responsive
        previewOnly.value = rawRows.value.length > PREVIEW_LIMIT;
      showColumnMapping.value = true;
    } catch (err) {
      console.error('xlsx parse failed', err);
      Notify.create({ message: 'Failed to parse Excel file.', color: 'negative' });
      // fallback to CSV parse attempt
      const reader = new FileReader();
      reader.onload = async () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        await parseCSV(text);
      };
      reader.readAsText(file);
    }
  } else {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      await parseCSV(text);
    };
    reader.readAsText(file);
  }

  // detect columns for preview
  setTimeout(() => {
    if (rawRows.value.length) {
      const keys = Object.keys(rawRows.value[0] as Record<string, unknown>);
      previewColumns.value = keys.map((k) => ({ name: k, label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()), field: k }));
      rowKey.value = keys.includes('email') ? 'email' : keys[0] || 'key';
    } else if (parsedUsers.value.length) {
      const keys = Object.keys(parsedUsers.value[0] as Record<string, unknown>);
      previewColumns.value = keys.map((k) => ({ name: k, label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()), field: k }));
      rowKey.value = keys.includes('email') ? 'email' : keys[0] || 'key';
    } else {
      previewColumns.value = [];
    }
  }, 50);
}

async function parseCSV(text: string): Promise<void> {
  try {
    const mod = await import('xlsx');
    const XLSX = mod as any;
    const wb = XLSX.read(text, { type: 'string' });
    const firstSheetName = wb.SheetNames && wb.SheetNames[0];
    if (!firstSheetName) {
      rawRows.value = [];
      showColumnMapping.value = false;
      return;
    }
    const sheet = wb.Sheets[firstSheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    rawRows.value = rows as Array<Record<string, unknown>>;
      previewOnly.value = rawRows.value.length > PREVIEW_LIMIT;
    columnMapping.value = {};

    const firstRow = rawRows.value[0] || {};
    const keys = Object.keys(firstRow);
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (lower.includes('fullname') || lower.includes('name')) columnMapping.value[key] = 'fullName';
      else if (lower.includes('email')) columnMapping.value[key] = 'email';
      else if (lower.includes('role')) columnMapping.value[key] = 'role';
      else if (lower.includes('status')) columnMapping.value[key] = 'status';
    }

    showColumnMapping.value = true;
  } catch (err) {
    console.error('csv parse failed (xlsx):', err);
    rawRows.value = [];
    showColumnMapping.value = false;
    Notify.create({ message: 'Failed to parse CSV', color: 'negative' });
  }
  isParsing.value = false;
}

function mapRawRowsToUsers(): UserModel[] {
  const users: UserModel[] = [];
  for (let idx = 0; idx < rawRows.value.length; idx++) {
    const row = rawRows.value[idx];
    if (!row) continue;
    const obj: Record<string, unknown> = {};
    for (const [csvCol, modelField] of Object.entries(columnMapping.value)) {
      obj[modelField] = row[csvCol];
    }

    const fullNameVal = obj['fullName'];
    const nameVal = obj['name'];
    const emailVal = obj['email'];
    const roleVal = obj['role'];
    const statusVal = obj['status'];

    const roleStr = typeof roleVal === 'string' && ['teacher', 'admin', 'supervisor', 'student'].includes(roleVal)
      ? (roleVal as 'teacher' | 'admin' | 'supervisor' | 'student')
      : 'student';
    const statusStr = typeof statusVal === 'string' && ['active', 'inactive', 'pending'].includes(statusVal)
      ? (statusVal as 'active' | 'inactive' | 'pending')
      : 'active';
    const keyStr = `${Date.now()}_${idx}`;

    users.push({
      key: keyStr,
      ownerKey: props.ownerKey || '',
      fullName: typeof fullNameVal === 'string' ? fullNameVal : (typeof nameVal === 'string' ? nameVal : ''),
      email: typeof emailVal === 'string' ? emailVal : '',
      role: roleStr,
      status: statusStr,
    });
  }
  return users;
}

function updatePreviewColumnsFromUsers(users: UserModel[]) {
  if (!users || !users.length) return;
  // users[0] is known to exist because of the length check. Cast through unknown
  // so TypeScript doesn't complain about incompatible index signatures on UserModel.
  const first = users[0] as unknown as Record<string, unknown>;
  const keys = Object.keys(first);
  previewColumns.value = keys.map((k) => ({ name: k, label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()), field: k }));
  rowKey.value = keys.includes('email') ? 'email' : keys[0] || 'key';
}

function continueToPreview() {
  // map only a subset for preview to avoid locking the UI on large files
  const limit = previewOnly.value ? PREVIEW_LIMIT : undefined;
  parsedUsers.value = mapRawRowsToUsers(limit);
  detectDuplicates();
  // ensure preview columns reflect mapped model fields
  updatePreviewColumnsFromUsers(parsedUsers.value);
  showColumnMapping.value = false;
}

function detectDuplicates(): void {
  const emailMap = new Map<string, number>();
  for (const user of parsedUsers.value) {
    if (user.email) {
      emailMap.set(user.email, (emailMap.get(user.email) || 0) + 1);
    }
  }
  duplicates.value = Array.from(emailMap.entries())
    .filter(([, count]) => count > 1)
    .map(([email, count]) => ({ email, count }));
}

async function confirmImport() {
  if (showColumnMapping.value) {
    parsedUsers.value = mapRawRowsToUsers();
    detectDuplicates();
    showColumnMapping.value = false;
    return;
  }

  if (!parsedUsers.value.length) return;
  isImporting.value = true;
  importErrors.value = [];
  importProgress.value = 0;
  importTotal.value = parsedUsers.value.length;
    // validate parsed users: ensure email and ownerKey exist
    const validated: UserModel[] = [];
    for (const u of parsedUsers.value) {
      if (!u.email) {
        importErrors.value.push({ user: u, error: 'Missing email' });
        continue;
      }
      if (!u.ownerKey) {
        importErrors.value.push({ user: u, error: 'Missing ownerKey (cannot assign record)' });
        continue;
      }
      validated.push(u);
    }
    if (!validated.length) {
      Notify.create({ message: 'No valid user rows to import', color: 'negative' });
      return;
    }

    try {
    const result = await userStore.importUsers(validated, (done, total) => {
      importProgress.value = done;
      importTotal.value = total;
    });

    if (result.failed && result.failed > 0) {
      importErrors.value = result.errors;
      Notify.create({ message: `Imported ${result.success} users; ${result.failed} failed`, color: 'warning' });
    } else {
      Notify.create({ message: `Imported ${result.success} users`, color: 'green' });
      parsedUsers.value = [];
      rawRows.value = [];
      columnMapping.value = {};
      duplicates.value = [];
      emit('update:modelValue', false);
    }
  } catch (e) {
    console.error('import failed', e);
    Notify.create({ message: 'Import failed', color: 'negative' });
  } finally {
    isImporting.value = false;
  }
}

function cancel() {
  parsedUsers.value = [];
  emit('update:modelValue', false);
}
</script>

<style scoped>
code { background:#f5f5f5; padding:2px 6px; border-radius:4px }
</style>
