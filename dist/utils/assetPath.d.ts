/**
 * Asset path helper functions
 *
 * These functions return paths assuming assets are copied to your public/assets/ folder.
 * After installing the package, copy assets: cp -r node_modules/virtual-avatar/assets public/assets
 */
/**
 * Get animation file path
 *
 * @param animationName - Animation filename (e.g., 'VRMA_01(全身を見せる).vrma')
 * @returns Path to the animation file
 *
 * @example
 * ```typescript
 * import { getAnimationPath } from 'virtual-avatar'
 * await avatar.animate(getAnimationPath('VRMA_01(全身を見せる).vrma'))
 * ```
 */
export declare function getAnimationPath(animationName: string): string;
/**
 * Get avatar file path
 *
 * @param avatarName - Avatar filename (e.g., 'AvatarSample_A.vrm')
 * @returns Path to the avatar file
 *
 * @example
 * ```typescript
 * import { getAvatarPath } from 'virtual-avatar'
 * const avatar = new AvatarSpeaker({ avatar: getAvatarPath('AvatarSample_A.vrm') })
 * ```
 */
export declare function getAvatarPath(avatarName: string): string;
//# sourceMappingURL=assetPath.d.ts.map