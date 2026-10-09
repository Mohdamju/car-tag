// Thin wrapper around a web-portal SDK (e.g. PokiSDK). Every call is a safe
// no-op when the SDK is not present, so the game runs standalone too.

export class Platform {
  constructor() {
    this.sdk = typeof window !== 'undefined' ? window.PokiSDK || null : null;
    this.playing = false;
  }

  async init() {
    if (!this.sdk) return;
    try {
      await this.sdk.init();
    } catch (e) {
      // Ad-blockers can make init reject; the game must still work.
      console.warn('Platform SDK init failed, continuing without it.', e);
    }
  }

  loadingFinished() {
    try {
      this.sdk?.gameLoadingFinished?.();
    } catch (e) {
      /* ignore */
    }
  }

  gameplayStart() {
    if (this.playing) return;
    this.playing = true;
    try {
      this.sdk?.gameplayStart?.();
    } catch (e) {
      /* ignore */
    }
  }

  gameplayStop() {
    if (!this.playing) return;
    this.playing = false;
    try {
      this.sdk?.gameplayStop?.();
    } catch (e) {
      /* ignore */
    }
  }

  happyTime(big) {
    try {
      if (big) this.sdk?.happyTime?.(1);
    } catch (e) {
      /* ignore */
    }
  }
}
