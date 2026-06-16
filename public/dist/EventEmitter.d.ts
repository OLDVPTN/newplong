/**
 * EventEmitter - simple event emitter
 * used to display loading status or error messages etc.
 */
export declare class EventEmitter {
    private listeners;
    on(event: string, listener: Function): void;
    off(event: string, listener: Function): void;
    emit(event: string, ...args: any[]): void;
    removeAllListeners(event?: string): void;
}
//# sourceMappingURL=EventEmitter.d.ts.map