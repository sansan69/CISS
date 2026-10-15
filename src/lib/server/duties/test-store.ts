// Isolated Firestore fixture: transactions serialize, stage writes atomically, and reject reads after writes.
export type Row = Record<string, any>;
export class TestStore {
  rows = new Map<string, Row>();
  private tail: Promise<unknown> = Promise.resolve();
  failCommit = false;
  collection(name: string): any {
    return new Query(this, name);
  }
  seed(name: string, id: string, value: Row) {
    this.rows.set(`${name}/${id}`, value);
  }
  row(name: string, id: string) {
    return this.rows.get(`${name}/${id}`);
  }
  list(name: string) {
    return [...this.rows.entries()].filter(([p]) => p.startsWith(`${name}/`)).map(([p, v]) => ({
      id: p.slice(name.length + 1),
      data: () => v,
      ref: new Ref(this, p)
    }));
  }
  async runTransaction(fn: (t: any) => Promise<any>) {
    const run = this.tail.then(async () => {
      const t = new Transaction(this);
      const value = await fn(t);
      if (this.failCommit)
        throw new Error('commit failed');
      t.commit();
      return value;
    });
    this.tail = run.catch(() => {
    });
    return run;
  }
  batch() {
    return new Transaction(this);
  }
}
class Ref {
  id: string;
  parent: {
    id: string;
  };
  constructor(readonly store: TestStore, readonly path: string) {
    const [c, id] = path.split('/');
    this.id = id;
    this.parent = {
      id: c
    };
  }
  async get() {
    const v = this.store.rows.get(this.path);
    return {
      id: this.id,
      exists: !!v,
      data: () => v,
      ref: this
    };
  }
  async set(data: Row, o?: {
    merge?: boolean;
  }) {
    this.store.rows.set(this.path, {
      ...(o?.merge ? this.store.rows.get(this.path) : {}),
      ...data
    });
  }
  async update(data: Row) {
    await this.set(data, {
      merge: true
    });
  }
}
class Query {
  private filters: [
    string,
    string,
    any
  ][] = [];
  private orders: [
    string,
    string
  ][] = [];
  private count = Infinity;
  private cursor = '';
  constructor(readonly store: TestStore, readonly name: string) {
  }
  doc(id = 'generated') {
    return new Ref(this.store, `${this.name}/${id}`);
  }
  where(f: string, o: string, v: any) {
    const q = this.clone();
    q.filters.push([f, o, v]);
    return q;
  }
  orderBy(f: string, d = 'asc') {
    const q = this.clone();
    q.orders.push([f, d]);
    return q;
  }
  limit(n: number) {
    const q = this.clone();
    q.count = n;
    return q;
  }
  startAfter(doc: any) {
    const q = this.clone();
    q.cursor = doc.id;
    return q;
  }
  private clone() {
    const q = new Query(this.store, this.name);
    q.filters = [...this.filters];
    q.orders = [...this.orders];
    q.count = this.count;
    q.cursor = this.cursor;
    return q;
  }
  async get() {
    const val = (v: any) => v?.toDate?.().getTime() ?? (v instanceof Date ? v.getTime() : v);
    let docs = this.store.list(this.name).filter(d => this.filters.every(([f, o, v]) => {
      const a = val(f === '__name__' ? d.id : d.data()[f]);
      const b = val(v);
      return o === '==' ? a === b : o === 'in' ? v.includes(a) : o === '>=' ? a >= b : o === '<=' ? a <= b : o === '<' ? a < b : false;
    }));
    docs.sort((a, b) => {
      for (const [f, d] of this.orders) {
        const av = val(f === '__name__' ? a.id : a.data()[f]);
        const bv = val(f === '__name__' ? b.id : b.data()[f]);
        if (av !== bv)
          return (av > bv ? 1 : -1) * (d === 'desc' ? -1 : 1);
      }
      return a.id.localeCompare(b.id);
    });
    if (this.cursor)
      docs = docs.slice(docs.findIndex(d => d.id === this.cursor) + 1);
    docs = docs.slice(0, this.count);
    return {
      docs,
      empty: docs.length === 0,
      size: docs.length
    };
  }
}
class Transaction {
  private writes: (() => void)[] = [];
  constructor(readonly store: TestStore) {
  }
  async get(ref: any) {
    if (this.writes.length)
      throw new Error('Firestore read after write');
    return ref.get();
  }
  async getAll(...refs: any[]) {
    return Promise.all(refs.map(r => this.get(r)));
  }
  set(ref: Ref, v: Row, o?: {
    merge?: boolean;
  }) {
    this.writes.push(() => {
      this.store.rows.set(ref.path, {
        ...(o?.merge ? this.store.rows.get(ref.path) : {}),
        ...v
      });
    });
    return this;
  }
  update(ref: Ref, v: Row) {
    return this.set(ref, v, {
      merge: true
    });
  }
  create(ref: Ref, v: Row) {
    this.writes.push(() => {
      if (this.store.rows.has(ref.path))
        throw new Error('already exists');
      this.store.rows.set(ref.path, v);
    });
    return this;
  }
  commit() {
    this.writes.forEach(w => w());
  }
}
