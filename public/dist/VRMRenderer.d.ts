/**
 * VRMRenderer - VRM model loading and rendering
 */
import * as THREE from 'three';
import { VRM } from '@pixiv/three-vrm';
import { EventEmitter } from './EventEmitter';
export declare class VRMRenderer extends EventEmitter {
    private canvas;
    private scene;
    private camera;
    private renderer;
    private vrm;
    private mixer;
    private clock;
    private animationId;
    private avatarPath;
    constructor(avatarPath: string, canvas?: HTMLCanvasElement | HTMLElement);
    private resize;
    private animate;
    load(): Promise<void>;
    loadVRM(path: string): Promise<void>;
    private applyNeutralPose;
    getVRM(): VRM | null;
    getMixer(): THREE.AnimationMixer | null;
    destroy(): void;
}
//# sourceMappingURL=VRMRenderer.d.ts.map