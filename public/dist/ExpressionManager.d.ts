/**
 * ExpressionManager - expression control
 */
import { VRMExpressionPresetName } from '@pixiv/three-vrm';
import { VRMRenderer } from './VRMRenderer';
import type { ExpressionType } from './types';
export declare class ExpressionManager {
    private renderer;
    constructor(renderer: VRMRenderer);
    initialize(): void;
    setExpression(expression: VRMExpressionPresetName, weight: number): void;
    setJoy(weight: number): void;
    setAngry(weight: number): void;
    setSorrow(weight: number): void;
    setFun(weight: number): void;
    setNeutral(): void;
    setExpressionType(type: ExpressionType): void;
}
//# sourceMappingURL=ExpressionManager.d.ts.map