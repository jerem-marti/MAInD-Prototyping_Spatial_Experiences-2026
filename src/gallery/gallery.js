/**
 * SHADOW CREATURES — Gallery
 * Standalone gallery SPA for browsing, previewing (Live Photo), and deleting snapshots.
 */

"use strict";

const Gallery = {
    snapshots: [],
    currentIndex: 0,

    /* -- Elements -- */
    els: {},

    _cacheEls() {
        this.els = {
            counter:   document.getElementById('gallery-counter'),
            title:     document.getElementById('gallery-title'),
            still:     document.getElementById('gallery-still'),
            video:     document.getElementById('gallery-video'),
            empty:     document.getElementById('gallery-empty'),
            timestamp: document.getElementById('gallery-timestamp'),
            btnClose:  document.getElementById('btn-gallery-close'),
            btnDelete: document.getElementById('btn-gallery-delete'),
            zonePrev:  document.getElementById('zone-prev'),
            zoneNext:  document.getElementById('zone-next'),
            viewer:    document.getElementById('gallery-viewer'),
        };
    },

    /* -- Init -- */

    async init() {
        this._cacheEls();
        await this.loadSnapshots();
        this.bindEvents();
        if (this.snapshots.length > 0) {
            this.show(0);
        }
    },

    /* -- Data -- */

    async loadSnapshots() {
        try {
            const res = await fetch('/api/snapshots');
            this.snapshots = await res.json();
        } catch (e) {
            console.error('[Gallery] Failed to load snapshots:', e);
            this.snapshots = [];
        }
        this._updateUI();
    },

    /* -- Navigation -- */

    show(index) {
        if (this.snapshots.length === 0) return;
        this.currentIndex = ((index % this.snapshots.length) + this.snapshots.length) % this.snapshots.length;

        const snap = this.snapshots[this.currentIndex];
        const { still, video, timestamp } = this.els;

        timestamp.textContent = snap.name;

        // Reset video state
        video.onended = null;
        video.pause();
        video.removeAttribute('src');
        video.load();

        if (snap.has_live) {
            // Live Photo: play video first, then reveal still
            video.src = '/snapshots/' + encodeURIComponent(snap.name) + '/live.webm';
            video.classList.remove('hidden');
            still.classList.add('hidden');

            video.play().catch(function() {
                // Video play failed — show still directly
                video.classList.add('hidden');
                still.classList.remove('hidden');
            });

            video.onended = function() {
                video.classList.add('hidden');
                still.classList.remove('hidden');
            };
        } else {
            video.classList.add('hidden');
            still.classList.remove('hidden');
        }

        still.src = '/snapshots/' + encodeURIComponent(snap.name) + '/still.png';
        this._updateCounter();
    },

    prev() {
        this.show(this.currentIndex - 1);
    },

    next() {
        this.show(this.currentIndex + 1);
    },

    /* -- Delete -- */

    _confirmPromise(message) {
        return new Promise(function(resolve) {
            var overlay = document.getElementById('confirm-overlay');
            var msgEl   = document.getElementById('confirm-message');
            var btnOk   = document.getElementById('confirm-ok');
            var btnCancel = document.getElementById('confirm-cancel');

            msgEl.textContent = message;
            overlay.classList.remove('hidden');

            function cleanup(result) {
                overlay.classList.add('hidden');
                btnOk.removeEventListener('click', onOk);
                btnCancel.removeEventListener('click', onCancel);
                resolve(result);
            }
            function onOk()     { cleanup(true); }
            function onCancel() { cleanup(false); }

            btnOk.addEventListener('click', onOk);
            btnCancel.addEventListener('click', onCancel);
        });
    },

    async deleteCurrent() {
        if (this.snapshots.length === 0) return;

        var snap = this.snapshots[this.currentIndex];
        var confirmed = await this._confirmPromise('Delete ' + snap.name + '?');
        if (!confirmed) return;

        try {
            await fetch('/api/snapshots/' + encodeURIComponent(snap.name), { method: 'DELETE' });
            this.snapshots.splice(this.currentIndex, 1);

            if (this.snapshots.length === 0) {
                this.els.still.removeAttribute('src');
                this.els.video.removeAttribute('src');
                this.els.video.classList.add('hidden');
                this.els.still.classList.add('hidden');
            } else {
                this.show(Math.min(this.currentIndex, this.snapshots.length - 1));
            }
            this._updateUI();
        } catch (e) {
            console.error('[Gallery] Delete failed:', e);
        }
    },

    /* -- Close -- */

    close() {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'gallery_close' }, '*');
        }
    },

    /* -- UI helpers -- */

    _updateCounter() {
        if (this.snapshots.length === 0) {
            this.els.counter.textContent = '0 / 0';
        } else {
            this.els.counter.textContent = (this.currentIndex + 1) + ' / ' + this.snapshots.length;
        }
    },

    _updateUI() {
        this._updateCounter();
        if (this.snapshots.length === 0) {
            this.els.empty.classList.remove('hidden');
            this.els.btnDelete.style.visibility = 'hidden';
        } else {
            this.els.empty.classList.add('hidden');
            this.els.btnDelete.style.visibility = 'visible';
        }
    },

    /* -- Events -- */

    bindEvents() {
        var self = this;

        // Touch zones
        this.els.zonePrev.addEventListener('click', function() { self.prev(); });
        this.els.zoneNext.addEventListener('click', function() { self.next(); });

        // Buttons
        this.els.btnClose.addEventListener('click', function() { self.close(); });
        this.els.btnDelete.addEventListener('click', function() { self.deleteCurrent(); });

        // Keyboard
        window.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowLeft') self.prev();
            else if (e.key === 'ArrowRight') self.next();
            else if (e.key === 'Escape') self.close();
        });

        // Swipe gestures
        this._initSwipe();
    },

    _initSwipe() {
        var self = this;
        var startX = 0;
        var viewer = this.els.viewer;

        viewer.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
        }, { passive: true });

        viewer.addEventListener('touchend', function(e) {
            var dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) > 50) {
                if (dx > 0) self.prev();
                else self.next();
            }
        }, { passive: true });
    }
};

// Init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { Gallery.init(); });
} else {
    Gallery.init();
}
