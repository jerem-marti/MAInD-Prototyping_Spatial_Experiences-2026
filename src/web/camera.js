/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures (Exhibition)
 * Camera module: STUBBED — no MJPEG feed in exhibition mode.
 * All blobs render on a dark background.
 */

const Camera = {
    img: null,
    active: false,

    start() {
        // No camera in exhibition mode
        this.active = false;
        State.cameraActive = false;
    },

    stop() {
        this.active = false;
        State.cameraActive = false;
    },

    toggle() {},
    getWidth() { return 1920; },
    getHeight() { return 1200; }
};
