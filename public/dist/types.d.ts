/**
 * AvatarSpeaker types definitions
 */
export interface AvatarSpeakerOptions {
    /** VRM file path or URL */
    avatar: string;
    /** canvas element or container element (auto generated if not specified) */
    canvas?: HTMLCanvasElement | HTMLElement;
    /** subtitle container element (auto generated if not specified) */
    subtitleContainer?: HTMLElement;
}
export interface AvatarSpeakerEventMap {
    ready: () => void;
    error: (error: Error) => void;
}
export type ExpressionType = 'joy' | 'fun' | 'neutral';
export type AudioSource = AudioBuffer | HTMLAudioElement | string;
export interface AvatarSpeakerEventMap {
    ready: () => void;
    error: (error: Error) => void;
}
//# sourceMappingURL=types.d.ts.map