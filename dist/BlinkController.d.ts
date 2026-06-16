/**
 * BlinkController - constant blinking control
 */
import { VRMRenderer } from './VRMRenderer';
export declare class BlinkController {
    private renderer;
    private isActive;
    private lastBlinkTime;
    private blinkInterval;
    private animationId;
    private time;
    constructor(renderer: VRMRenderer);
    start(): void;
    stop(): void;
    private update;
    private blink;
}
//# sourceMappingURL=BlinkController.d.ts.map