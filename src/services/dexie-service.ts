// Dependency-free in-memory localDb shim compatible with the parts of the
// app that expect a Dexie-style interface. This allows the app to run in
// development without requiring the `dexie` dependency while still providing
// add/get/update/delete/where/filter/each/toArray semantics.

export type DbItem = Record<string, any> & { key?: string; path?: string };

const TABLE_NAMES = [
  'users',
  'classes',
  'teachers',
  'enrolled',
  'meetings',
  'check-ins',
  'class-keepings',
] as const;

function normalizeKey(key: any) {
  if (Array.isArray(key)) return JSON.stringify(key);
  return String(key);
}

class Table<T = any> {
  name: string;
  private records: Map<string, T & DbItem>;

  constructor(name: string) {
    this.name = name;
    this.records = new Map();
  }

  add(item: T & DbItem) {
    const key = normalizeKey(item.key ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    item.key = item.key ?? key;
    this.records.set(key, { ...item });
    return Promise.resolve(key);
  }

  get(key: any): Promise<T & DbItem | undefined> {
    const k = normalizeKey(key);
    return Promise.resolve(this.records.get(k));
  }

  update(key: any, updates: Partial<T & DbItem>): Promise<number> {
    const k = normalizeKey(key);
    const rec = this.records.get(k);
    if (!rec) return Promise.resolve(0);
    const merged = { ...rec, ...updates } as DbItem;
    this.records.set(k, merged as T & DbItem);
    return Promise.resolve(1);
  }

  delete(key: any): Promise<boolean> {
    const k = normalizeKey(key);
    return Promise.resolve(this.records.delete(k));
  }

  where(condition?: Partial<Record<string, any>> | ((r: T & DbItem) => boolean)) {
    // use `this` directly instead of creating an alias
    const predicate =
      typeof condition === 'function'
        ? (condition as (r: DbItem) => boolean)
        : (r: DbItem) => {
            if (!condition) return true;
            return Object.entries(condition).every(([k, v]) => (r as any)[k] === v);
          };

    return {
      toArray: () => Promise.resolve(Array.from(this.records.values()).filter(predicate)),
      each: async (fn: (r: DbItem) => void | Promise<void>) => {
        for (const rec of Array.from(this.records.values()).filter(predicate)) {
          // allow async fn
          await fn(rec);
        }
      },
    };
  }

  filter(predicate: (r: T & DbItem) => boolean) {
    return this.where(predicate as any);
  }

  toArray(): Promise<Array<T & DbItem>> {
    return Promise.resolve(Array.from(this.records.values()));
  }
}

class LocalDb {
  tables: any[]; // intentionally permissive: the app expects heterogeneous tables
  private tableMap: Map<string, Table>;

  constructor() {
    this.tables = [];
    this.tableMap = new Map();
    for (const name of TABLE_NAMES) {
      const t = new Table(name);
      this.tables.push(t);
      this.tableMap.set(name, t);
    }
  }

  table<T = any>(name: string) {
    if (!this.tableMap.has(name)) {
      const t = new Table(name);
      this.tableMap.set(name, t);
      this.tables.push(t);
    }
    return this.tableMap.get(name)! as unknown as Table<T>;
  }
}

export const localDb = new LocalDb();

export default localDb;
