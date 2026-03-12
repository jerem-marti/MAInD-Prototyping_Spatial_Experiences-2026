/**
 * @file OrientationManager (Exhibition)
 * @description STUBBED — no IMU, no orientation. Fixed view at (0, 0).
 */
const OrientationManager = {
    _source: 'fixed',
    _preferred: 'fixed',
    _imuAvailable: false,

    init() {
        State.viewYaw = 0;
        State.viewPitch = 0;
        console.log('[OrientationManager] Exhibition mode — fixed orientation');
    },

    onIMUData(_data) {},
    setPreferred(_pref) {},
    resetNorth() {},
    async requestPermission() { return true; },
    getSourceName() { return 'fixed'; }
};
