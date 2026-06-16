/**
 * AnimationManager
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
export class AnimationManager {
    constructor(renderer) {
        this.clipCache = new Map();
        this.idleAction = null;
        this.renderer = renderer;
    }
    async ensureIdle() {
        const mixer = this.renderer.getMixer();
        const vrm = this.renderer.getVRM();
        if (!mixer || !vrm)
            return;
        const idlePath = '/assets/animations/standard_idle.vrma';
        try {
            const idleClip = await this.getOrLoadClip(idlePath);
            if (idleClip) {
                const action = mixer.clipAction(idleClip);
                action.setLoop(THREE.LoopRepeat, Infinity);
                action.fadeIn(0.3).play();
                this.idleAction = action;
                return;
            }
        }
        catch (e) {
            console.warn('[AvatarSpeaker] Idle animation not available');
        }
    }
    async playAnimation(path) {
        const mixer = this.renderer.getMixer();
        const vrm = this.renderer.getVRM();
        if (!mixer || !vrm) {
            console.warn('[AvatarSpeaker] Animation not available');
            return;
        }
        try {
            const clip = await this.getOrLoadClip(path);
            if (!clip) {
                console.warn(`[AvatarSpeaker] Animation not found: ${path}`);
                return;
            }
            const action = mixer.clipAction(clip);
            action.reset();
            action.setLoop(THREE.LoopOnce, 0);
            action.clampWhenFinished = true;
            action.enabled = true;
            action.play();
            if (this.idleAction && this.idleAction !== action) {
                action.crossFadeFrom(this.idleAction, 0.3, false);
            }
            else {
                action.fadeIn(0.3);
            }
            await new Promise((resolve) => {
                const handleFinished = (e) => {
                    if (e?.action === action) {
                        mixer.removeEventListener('finished', handleFinished);
                        if (this.idleAction && this.idleAction !== action) {
                            this.idleAction.enabled = true;
                            this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
                            this.idleAction.play();
                            this.idleAction.crossFadeFrom(action, 0.3, false);
                        }
                        resolve();
                    }
                };
                mixer.addEventListener('finished', handleFinished);
            });
        }
        catch (error) {
            console.warn(`[AvatarSpeaker] Animation playback failed: ${path}`, error);
        }
    }
    async getOrLoadClip(path) {
        const cached = this.clipCache.get(path);
        if (cached)
            return cached;
        try {
            const loader = new GLTFLoader();
            loader.crossOrigin = 'anonymous';
            loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
            const gltf = await loader.loadAsync(path);
            const vrmAnimation = gltf?.userData?.vrmAnimations?.[0];
            if (!vrmAnimation)
                return null;
            const vrm = this.renderer.getVRM();
            if (!vrm)
                return null;
            const clip = createVRMAnimationClip(vrmAnimation, vrm);
            this.clipCache.set(path, clip);
            return clip;
        }
        catch (error) {
            console.warn(`[AvatarSpeaker] Failed to load animation: ${path}`, error);
            return null;
        }
    }
    destroy() {
        this.clipCache.clear();
        this.idleAction = null;
    }
}
