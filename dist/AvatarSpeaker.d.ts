/**
 * AvatarSpeaker
 */
import type { AvatarSpeakerOptions, AudioSource, AvatarSpeakerEventMap } from './types';
export declare class AvatarSpeaker {
    private renderer;
    private lipSync;
    private expressionManager;
    private animationManager;
    private blinkController;
    private subtitleRenderer;
    private eventListeners;
    private isReady;
    private readyPromise;
    private readyResolve?;
    private expressionTimer;
    constructor(options: AvatarSpeakerOptions);
    /**
     * initialize avatar speaker
     */
    private initialize;
    /**
     * wait for ready
     */
    ready(): Promise<void>;
    /**
     * register event listener
     */
    on<K extends keyof AvatarSpeakerEventMap>(event: K, listener: AvatarSpeakerEventMap[K]): void;
    /**
     * remove event listener
     */
    off<K extends keyof AvatarSpeakerEventMap>(event: K, listener: AvatarSpeakerEventMap[K]): void;
    private emit;
    /**
     * say
     *
     * @param text text to say
     * @param options options (audio: audio data)
     */
    say(text: string, options?: {
        audio?: AudioSource;
    }): Promise<void>;
    private sayWithAudio;
    private sayWithoutAudio;
    private estimateSpeechDuration;
    /**
     * Set expression with auto-reset
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    private setExpressionWithTimer;
    /**
     * Set happy expression (smile)
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    smile(duration?: number): void;
    /**
     * Set angry expression
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    angry(duration?: number): void;
    /**
     * Set sad expression
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    sad(duration?: number): void;
    /**
     * Set fun expression
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    fun(duration?: number): void;
    /**
     * Reset expression to neutral
     */
    neutral(): void;
    /**
     * play idle animation
     */
    idle(): Promise<void>;
    /**
     * bow
     */
    bow(): Promise<void>;
    /**
     * play animation
     *
     * @param path animation file path ( .vrma or .glb )
     */
    animate(path: string): Promise<void>;
    /**
     * set avatar
     *
     * @param avatarPath new VRM file path
     */
    setAvatar(avatarPath: string): Promise<void>;
    /**
     * clean up
     */
    destroy(): void;
}
export type { AvatarSpeakerOptions, ExpressionType, AudioSource, AvatarSpeakerEventMap } from './types';
//# sourceMappingURL=AvatarSpeaker.d.ts.map