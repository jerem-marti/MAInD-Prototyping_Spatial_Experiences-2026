/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * Camera module: loads MJPEG stream from the Pi backend.
 *
 * Uses the backend's /mjpeg endpoint as a continuous image source.
 * The <img> element receives MJPEG frames automatically.
 */

const Camera = {
    img: null,
    active: false,

    /**
     * Start loading the MJPEG feed from /mjpeg.
     * Sets State.image once the first frame arrives.
     */
    start() {
        this.img = document.getElementById('feed');
        if (!this.img) {
            this.img = document.createElement('img');
            this.img.id = 'feed';
            this.img.style.display = 'none';
            document.body.appendChild(this.img);
        }

        this.img.crossOrigin = 'anonymous';

        this.img.onload = () => {
            if (!this.active) {
                this.active = true;
                State.cameraActive = true;
                State.image = this.img;
                // Upload to ImageDeformPass for color sampling
                if (typeof ImageDeformPass !== 'undefined' && ImageDeformPass.uploadImage) {
                    ImageDeformPass.uploadImage(this.img);
                }
            }
        };

        this.img.onerror = () => {
            // MJPEG stream not available — will retry on reconnect
            console.warn('[Camera] MJPEG stream not available');
        };

        // Start the MJPEG stream
        this.img.src = '/mjpeg';
    },

    stop() {
        if (this.img) {
            this.img.src = '';
        }
        this.active = false;
        State.cameraActive = false;
    },

    toggle() {
        if (this.active) this.stop();
        else this.start();
    },

    getWidth() {
        return this.img ? this.img.naturalWidth || 1280 : 1280;
    },

    getHeight() {
        return this.img ? this.img.naturalHeight || 720 : 720;
    }
};
