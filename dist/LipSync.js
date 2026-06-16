/**
 * LipSync - lip sync control
 */
import * as THREE from 'three';
import { VRMExpressionPresetName } from '@pixiv/three-vrm';
export class LipSync {
    constructor(renderer) {
        this.isActive = false;
        this.time = 0;
        this.animationId = null;
        this.update = () => {
            if (!this.isActive)
                return;
            const vrm = this.renderer.getVRM();
            if (vrm?.expressionManager) {
                const deltaTime = Math.min(this.clock.getDelta(), 0.1);
                this.time += deltaTime;
                const weight = (Math.sin(this.time * 10) + 1) / 2;
                vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, weight);
            }
            this.animationId = requestAnimationFrame(this.update);
        };
        this.renderer = renderer;
        this.clock = new THREE.Clock();
    }
    start() {
        if (this.isActive)
            return;
        this.isActive = true;
        this.time = 0;
        this.clock.start();
        this.update();
    }
    stop() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.clock.stop();
        const vrm = this.renderer.getVRM();
        if (vrm?.expressionManager) {
            vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, 0);
        }
    }
}
