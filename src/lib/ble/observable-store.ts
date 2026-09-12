/**
 * Minimal snapshot store.
 *
 * Device sources push state from Bluetooth callbacks that live outside React, so
 * they expose an immutable snapshot plus a subscribe function and let
 * `useSyncExternalStore` handle the bridge.
 */
export class ObservableStore<T extends object> {
  private current: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.current = initial;
  }

  get snapshot(): T {
    return this.current;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): T => this.current;

  /**
   * Replaces the snapshot with a shallow-merged copy. A new object identity on
   * every change is what lets `useSyncExternalStore` detect updates.
   */
  protected patch(partial: Partial<T>): void {
    this.current = { ...this.current, ...partial };
    this.emit();
  }

  protected replace(next: T): void {
    this.current = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
