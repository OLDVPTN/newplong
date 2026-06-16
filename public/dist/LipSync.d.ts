/**
 * LipSync - lip sync control
 */
import { VRMRenderer } from './VRMRenderer';
export declare class LipSync {
    private renderer;
    private isActive;
    private time;
    private animationId;
    private clock;
    constructor(renderer: VRMRenderer);
    start(): void;
    stop(): void;
    private update;
}
//# sourceMappingURL=LipSync.d.ts.map