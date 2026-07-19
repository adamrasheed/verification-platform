export type CancellationReason =
  | "caller"
  | "deadline"
  | "shutdown"
  | "integrity";

export class CancellationError extends Error {
  readonly reason: CancellationReason;

  constructor(reason: CancellationReason) {
    super(`cancelled: ${reason}`);
    this.name = "CancellationError";
    this.reason = reason;
  }
}

export interface CancellationToken {
  readonly cancelled: boolean;
  readonly reason: CancellationReason | undefined;
  throwIfCancelled(): void;
  subscribe(listener: (reason: CancellationReason) => void): () => void;
}

export class CancellationSource implements CancellationToken {
  #reason: CancellationReason | undefined;
  readonly #listeners = new Set<(reason: CancellationReason) => void>();
  readonly #unsubscribeParent: (() => void) | undefined;

  constructor(parent?: CancellationToken) {
    if (parent !== undefined) {
      this.#unsubscribeParent = parent.subscribe((reason) => {
        this.cancel(reason);
      });
      if (parent.cancelled && parent.reason !== undefined) {
        this.cancel(parent.reason);
      }
    }
  }

  get cancelled(): boolean {
    return this.#reason !== undefined;
  }

  get reason(): CancellationReason | undefined {
    return this.#reason;
  }

  cancel(reason: CancellationReason): boolean {
    if (this.#reason !== undefined) return false;
    this.#reason = reason;
    for (const listener of [...this.#listeners]) listener(reason);
    this.#listeners.clear();
    this.#unsubscribeParent?.();
    return true;
  }

  throwIfCancelled(): void {
    if (this.#reason !== undefined) throw new CancellationError(this.#reason);
  }

  subscribe(listener: (reason: CancellationReason) => void): () => void {
    if (this.#reason !== undefined) {
      listener(this.#reason);
      return (): void => {};
    }
    this.#listeners.add(listener);
    return (): void => {
      this.#listeners.delete(listener);
    };
  }
}
