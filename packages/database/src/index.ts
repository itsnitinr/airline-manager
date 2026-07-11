export interface DatabaseLifecycle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
