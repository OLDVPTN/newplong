/**
 * AvatarSpeaker
 */
import { VRMRenderer } from './VRMRenderer';
import { LipSync } from './LipSync';
import { ExpressionManager } from './ExpressionManager';
import { AnimationManager } from './AnimationManager';
import { BlinkController } from './BlinkController';
import { SubtitleRenderer } from './SubtitleRenderer';
export class AvatarSpeaker {
    constructor(options) {
        this.eventListeners = new Map();
        this.isReady = false;
        this.expressionTimer = null;
        this.eventListeners.set('ready', new Set());
        this.eventListeners.set('error', new Set());
        this.readyPromise = new Promise((resolve) => {
            this.readyResolve = resolve;
        });
        this.renderer = new VRMRenderer(options.avatar, options.canvas);
        this.lipSync = new LipSync(this.renderer);
        this.expressionManager = new ExpressionManager(this.renderer);
        this.animationManager = new AnimationManager(this.renderer);
        this.blinkController = new BlinkController(this.renderer);
        this.subtitleRenderer = new SubtitleRenderer(options.subtitleContainer);
        this.renderer.on('error', (error) => {
            this.emit('error', error);
        });
        this.initialize();
    }
    /**
     * initialize avatar speaker
     */
    async initialize() {
        try {
            await this.renderer.load();
            this.expressionManager.initialize();
            this.blinkController.start();
            await this.animationManager.ensureIdle();
            await new Promise(resolve => setTimeout(resolve, 500));
            this.isReady = true;
            this.readyResolve?.();
            this.emit('ready');
        }
        catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * wait for ready
     */
    async ready() {
        return this.readyPromise;
    }
    /**
     * register event listener
     */
    on(event, listener) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event).add(listener);
    }
    /**
     * remove event listener
     */
    off(event, listener) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(listener);
        }
    }
    emit(event, ...args) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach((listener) => {
                try {
                    ;
                    listener(...args);
                }
                catch (error) {
                    console.error(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }
    /**
     * say
     *
     * @param text text to say
     * @param options options (audio: audio data)
     */
    async say(text, options) {
        if (!this.isReady) {
            await this.ready();
        }
        this.subtitleRenderer.show(text);
        // if audio is provided, say with audio
        if (options?.audio) {
            await this.sayWithAudio(text, options.audio);
        }
        else {
            // if audio is not provided, say with text
            await this.sayWithoutAudio(text);
        }
    }
    async sayWithAudio(text, audio) {
        let audioElement = null;
        try {
            if (audio instanceof HTMLAudioElement) {
                audioElement = audio;
            }
            else if (audio instanceof AudioBuffer) {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const source = audioCtx.createBufferSource();
                source.buffer = audio;
                const dest = audioCtx.createMediaStreamDestination();
                source.connect(dest);
                source.start();
                audioElement = new Audio();
                audioElement.srcObject = dest.stream;
            }
            else if (typeof audio === 'string') {
                audioElement = new Audio(audio);
            }
            if (!audioElement) {
                throw new Error('Invalid audio source');
            }
            this.lipSync.start();
            await new Promise((resolve, reject) => {
                audioElement.onended = () => {
                    this.lipSync.stop();
                    this.subtitleRenderer.hide();
                    resolve();
                };
                audioElement.onerror = () => {
                    this.lipSync.stop();
                    this.subtitleRenderer.hide();
                    reject(new Error('Audio playback failed'));
                };
                audioElement.play().catch(reject);
            });
        }
        catch (error) {
            this.lipSync.stop();
            this.subtitleRenderer.hide();
            throw error;
        }
    }
    async sayWithoutAudio(text) {
        const duration = this.estimateSpeechDuration(text);
        this.lipSync.start();
        await new Promise(resolve => setTimeout(resolve, duration));
        this.lipSync.stop();
        this.subtitleRenderer.hide();
    }
    estimateSpeechDuration(text) {
        const japaneseChars = (text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length;
        const englishWords = text.split(/\s+/).filter(w => /^[a-zA-Z]+$/.test(w)).length;
        return Math.max(1000, japaneseChars * 100 + englishWords * 500);
    }
    /**
     * Set expression with auto-reset
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    setExpressionWithTimer(expressionFn, duration = 1000) {
        if (!this.isReady) {
            console.warn('AvatarSpeaker is not ready yet');
            return;
        }
        if (this.expressionTimer) {
            clearTimeout(this.expressionTimer);
            this.expressionTimer = null;
        }
        expressionFn();
        // reset the expression after a certain time
        this.expressionTimer = setTimeout(() => {
            this.expressionManager.setNeutral();
            this.expressionTimer = null;
        }, duration);
    }
    /**
     * Set happy expression (smile)
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    smile(duration = 1000) {
        this.setExpressionWithTimer(() => {
            this.expressionManager.setJoy(1);
        }, duration);
    }
    /**
     * Set angry expression
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    angry(duration = 1000) {
        this.setExpressionWithTimer(() => {
            this.expressionManager.setAngry(1);
        }, duration);
    }
    /**
     * Set sad expression
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    sad(duration = 1000) {
        this.setExpressionWithTimer(() => {
            this.expressionManager.setSorrow(1);
        }, duration);
    }
    /**
     * Set fun expression
     * @param duration expression duration (milliseconds). default is 1000ms (1 second)
     */
    fun(duration = 1000) {
        this.setExpressionWithTimer(() => {
            this.expressionManager.setFun(1);
        }, duration);
    }
    /**
     * Reset expression to neutral
     */
    neutral() {
        if (this.expressionTimer) {
            clearTimeout(this.expressionTimer);
            this.expressionTimer = null;
        }
        this.expressionManager.setNeutral();
    }
    /**
     * play idle animation
     */
    async idle() {
        if (!this.isReady) {
            console.warn('AvatarSpeaker is not ready yet');
            return;
        }
        await this.animationManager.ensureIdle();
    }
    /**
     * bow
     */
    async bow() {
        if (!this.isReady) {
            console.warn('AvatarSpeaker is not ready yet');
            return;
        }
        await this.animationManager.playAnimation('/assets/animations/quick_formal_bow.vrma');
    }
    /**
     * play animation
     *
     * @param path animation file path ( .vrma or .glb )
     */
    async animate(path) {
        if (!this.isReady) {
            console.warn('AvatarSpeaker is not ready yet');
            return;
        }
        await this.animationManager.playAnimation(path);
    }
    /**
     * set avatar
     *
     * @param avatarPath new VRM file path
     */
    async setAvatar(avatarPath) {
        await this.renderer.loadVRM(avatarPath);
        this.expressionManager.initialize();
        this.blinkController.start();
        await this.animationManager.ensureIdle();
    }
    /**
     * clean up
     */
    destroy() {
        // clean up the expression timer
        if (this.expressionTimer !== null) {
            clearTimeout(this.expressionTimer);
            this.expressionTimer = null;
        }
        this.blinkController.stop();
        this.lipSync.stop();
        this.animationManager.destroy();
        this.renderer.destroy();
        this.subtitleRenderer.destroy();
        this.eventListeners.clear();
    }
}
