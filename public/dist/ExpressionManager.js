/**
 * ExpressionManager - expression control
 */
import { VRMExpressionPresetName } from '@pixiv/three-vrm';
export class ExpressionManager {
    constructor(renderer) {
        this.renderer = renderer;
    }
    initialize() {
        this.setNeutral();
    }
    setExpression(expression, weight) {
        const vrm = this.renderer.getVRM();
        if (vrm?.expressionManager) {
            vrm.expressionManager.setValue(expression, weight);
        }
        else {
            console.warn('[AvatarSpeaker] Expression not available');
        }
    }
    setJoy(weight) {
        this.setExpression(VRMExpressionPresetName.Happy, weight);
    }
    setAngry(weight) {
        this.setExpression(VRMExpressionPresetName.Angry, weight);
    }
    setSorrow(weight) {
        this.setExpression(VRMExpressionPresetName.Sad, weight);
    }
    setFun(weight) {
        this.setExpression(VRMExpressionPresetName.Happy, weight * 0.5);
    }
    setNeutral() {
        const vrm = this.renderer.getVRM();
        if (vrm?.expressionManager) {
            const expressionManager = vrm.expressionManager;
            const presets = [
                VRMExpressionPresetName.Happy,
                VRMExpressionPresetName.Angry,
                VRMExpressionPresetName.Sad,
            ];
            presets.forEach((preset) => {
                expressionManager.setValue(preset, 0);
            });
        }
    }
    setExpressionType(type) {
        switch (type) {
            case 'joy':
                this.setJoy(1);
                break;
            case 'fun':
                this.setFun(1);
                break;
            case 'neutral':
            default:
                this.setNeutral();
                break;
        }
    }
}
