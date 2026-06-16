/**
 * AnimationManager
 */
import { VRMRenderer } from './VRMRenderer';
export declare class AnimationManager {
    private renderer;
    private clipCache;
    private idleAction;
    constructor(renderer: VRMRenderer);
    ensureIdle(): Promise<void>;
    playAnimation(path: string): Promise<void>;
    private getOrLoadClip;
    destroy(): void;
}
//# sourceMappingURL=AnimationManager.d.ts.map