import { AsyncLocalStorage } from 'node:async_hooks';

// One SQLite connection has one transaction state. Keep every statement outside
// an active transaction waiting, while allowing its own statements/savepoints.
export class SqliteExecutionQueue {
  private readonly owner = new AsyncLocalStorage<{ active: boolean }>();
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    const current = this.owner.getStore();
    if (current) {
      if (!current.active) throw new Error('SQLite transaction context has already completed');
      return operation();
    }

    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const owner = { active: true };
    try {
      return await this.owner.run(owner, operation);
    } finally {
      owner.active = false;
      release();
    }
  }
}
