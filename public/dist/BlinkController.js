/**
 * BlinkController - constant blinking control
 */
import { VRMExpressionPresetName } from '@pixiv/three-vrm';
export class BlinkController {
    constructor(renderer) {
        this.isActive = false;
        this.lastBlinkTime = 0;
        this.blinkInterval = 3000; // 3 seconds interval
        this.animationId = null;
        this.time = 0;
        this.update = () => {
            if (!this.isActive)
                return;
            const vrm = this.renderer.getVRM();
            if (!vrm?.expressionManager) {
                this.animationId = requestAnimationFrame(this.update);
                return;
            }
            // check the weight of the current expression (if the expression is set, it is disabled)
            const currentHappyWeight = vrm.expressionManager.getValue(VRMExpressionPresetName.Happy) || 0;
            const currentAngryWeight = vrm.expressionManager.getValue(VRMExpressionPresetName.Angry) || 0;
            const currentSadWeight = vrm.expressionManager.getValue(VRMExpressionPresetName.Sad) || 0;
            // blink if the expression is not set
            if (currentHappyWeight === 0 && currentAngryWeight === 0 && currentSadWeight === 0) {
                const currentTime = this.time * 1000;
                if (currentTime - this.lastBlinkTime > this.blinkInterval) {
                    this.blink();
                    this.lastBlinkTime = currentTime;
                    // set the interval for the next blink (2-5 seconds)
                    this.blinkInterval = 2000 + Math.random() * 3000;
                }
            }
            this.time += 0.016; // approximately 60fps
            this.animationId = requestAnimationFrame(this.update);
        };
        this.renderer = renderer;
    }
    start() {
        if (this.isActive)
            return;
        this.isActive = true;
        this.lastBlinkTime = 0;
        this.time = 0;
        this.update();
    }
    stop() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    blink() {
        const vrm = this.renderer.getVRM();
        if (!vrm?.expressionManager)
            return;
        const blinkDuration = 150; // 0.15 seconds
        const blinkWeight = 1.0;
        vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, blinkWeight);
        setTimeout(() => {
            if (vrm?.expressionManager) {
                vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, 0);
            }
        }, blinkDuration);
    }
}
