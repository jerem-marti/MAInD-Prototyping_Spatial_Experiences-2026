/**
 * GHOST SIGNAL INSTRUMENT — Shadow Creatures
 * Application state: single source of truth.
 */

const State = {
    image: null,
    imageRect: { x: 0, y: 0, w: 0, h: 0 },
    layers: [],
    signals: [],
    selectedSignalId: null,
    selectedLayerId: null,
    isPlacingSignal: false,
    isDeforming: false,
    resolution: { w: 0, h: 0 },
    cameraActive: false,
    useManualParams: false,  // When true, telemetry mapping is skipped
    mode: 2,                 // 0=AP fog, 1=BT sparks, 2=both

    // Gallery
    galleryOpen: false,      // true when gallery iframe is active
    paused: false,           // true = render loop and telemetry ingestion paused

    // View orientation (degrees) — controlled by OrientationManager
    viewYaw: 0,              // 0-360, horizontal pan on the virtual sphere
    viewPitch: 0,            // -90 to +90, vertical tilt

    // Camera frustum (degrees, matching physical camera)
    cameraFov: { h: 66, v: 41 },

    // Device globe settings
    // maxSignals is computed from FOV so ~targetVisibleSignals end up on screen
    // after frustum culling. Devices are hash-distributed on a 360x180 sphere;
    // the visible fraction = (fov.h / 360) * (fov.v / 180).
    targetVisibleSignals: 16,
    get maxSignals() {
        const frac = (this.cameraFov.h / 360) * (this.cameraFov.v / 180);
        return Math.round(this.targetVisibleSignals / Math.max(0.01, frac));
    },

    // Type-based size multipliers for visual differentiation
    // (1.0 = default size from TelemetryMapper; >1 = larger, <1 = smaller)
    typeSizes: {
        'Wi-Fi AP':     1.6,   // large fog blobs
        'Wi-Fi Client': 1.0,   // standard
        'Bluetooth':    0.5,   // small compact sparks
    },

    // Minimum RSSI threshold — signals weaker than this are filtered out
    minRssiThreshold: -85,

    // Per-device data from current state (populated by Telemetry.ingestState)
    devices: [],             // Array of { mac, azimuth, elevation, rssi, name, manuf, ... }

    // Map of mac -> SignalAnchor for dynamically managed signals
    deviceSignalMap: new Map()
};
