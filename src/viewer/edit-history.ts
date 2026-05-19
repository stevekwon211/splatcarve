export interface EditOp {
  /** Reapplies the op. Called by `redo()` after a corresponding `undo()`. */
  do(): void;
  /** Reverses the op. Called by `undo()`. */
  undo(): void;
}

/**
 * Bounded, linear undo/redo stack.
 *
 * The caller is expected to invoke `op.do()` themselves at the point of the
 * original action — `record()` just remembers the op. This keeps the history
 * neutral about whether the op is idempotent on first run vs replay.
 *
 * Recording a new op after one or more `undo()` calls truncates the redo stack.
 * Capacity overflow drops the oldest op (the eviction is silent).
 */
export class EditHistory {
  private readonly capacity: number;
  private undoStack: EditOp[] = [];
  private redoStack: EditOp[] = [];

  constructor(capacity = 100) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`EditHistory capacity must be > 0, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.undoStack.length;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(op: EditOp): void {
    this.undoStack.push(op);
    this.redoStack.length = 0;
    while (this.undoStack.length > this.capacity) this.undoStack.shift();
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    op.undo();
    this.redoStack.push(op);
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    op.do();
    this.undoStack.push(op);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
