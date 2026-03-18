# Data Contract

## ghost_state.json

This file is the single source of truth exchanged between the Reducer and the Backend/Frontend. It is written atomically (~1 Hz) by `reducer.py` and watched by `server.py`.

### Schema

```json
{
  "ts": 1709568600.123,
  "window_s": 60,
  "views": {
    "wifi": "phydot11_accesspoints",
    "wifi_all": "phy-IEEE802.11",
    "bt": "phybluetooth"
  },
  "wifi": {
    "aps": [
      {
        "id": "a3f1...hex64",
        "name": "MyNetwork",
        "last_seen": 1709568590,
        "channel": 6,
        "signal_dbm": -45,
        "strength": 0.75,
        "burst_rate": 142
      }
    ],
    "clients": [
      {
        "id": "c2d4...hex64",
        "name": "(client)",
        "last_seen": 1709568588,
        "signal_dbm": -55,
        "strength": 0.58,
        "burst_rate": 28
      }
    ]
  },
  "bt": {
    "devices": [
      {
        "id": "b4e2...hex64",
        "name": "(bt)",
        "last_seen": 1709568585,
        "signal_dbm": -70,
        "strength": 0.33
      }
    ]
  },
  "telemetry": {
    "wifi_ap_count": 12,
    "wifi_client_count": 8,
    "wifi_count": 20,
    "bt_count": 5,
    "total_count": 25,
    "wifi_mean_rssi": -52.3,
    "wifi_rssi_variance": 8.7,
    "ble_ratio": 0.2,
    "wifi_burst_rate": 1542
  }
}
```

### Top-level Fields

| Field | Type | Description |
|---|---|---|
| `ts` | float | Unix epoch (seconds) when this state was generated |
| `window_s` | int | Kismet time window in seconds (default 60) |
| `views` | object | Which Kismet view name was used for each category (`null` if unavailable) |
| `wifi` | object | Contains `aps` and `clients` arrays |
| `bt` | object | Contains `devices` array |
| `telemetry` | object | Aggregate telemetry stats for the visual effect engine |

### Views Object

| Field | Type | Description |
|---|---|---|
| `wifi` | string/null | Kismet view used for Wi-Fi APs |
| `wifi_all` | string/null | Kismet view used for Wi-Fi clients |
| `bt` | string/null | Kismet view used for Bluetooth devices |

### Wi-Fi AP Object (`wifi.aps[]`)

| Field | Type | Description |
|---|---|---|
| `id` | string | SHA-256 hash of salted MAC address (64 hex chars) |
| `name` | string | SSID or common name (max 64 chars, `"(unknown)"` if absent) |
| `last_seen` | float | Unix epoch of last detection by Kismet |
| `channel` | int/null | Wi-Fi channel |
| `signal_dbm` | int/null | Raw signal strength in dBm |
| `strength` | float 0-1 | Normalized: `clamp((dBm + 90) / 60, 0, 1)` |
| `burst_rate` | int | Sum of packets in last 60-second RRD minute vector |

### Wi-Fi Client Object (`wifi.clients[]`)

| Field | Type | Description |
|---|---|---|
| `id` | string | SHA-256 hash of salted MAC address (64 hex chars) |
| `name` | string | Device name (max 64 chars, `"(client)"` if absent) |
| `last_seen` | float | Unix epoch of last detection by Kismet |
| `signal_dbm` | int/null | Raw signal strength in dBm |
| `strength` | float 0-1 | Normalized: `clamp((dBm + 90) / 60, 0, 1)` |
| `burst_rate` | int | Sum of packets in last 60-second RRD minute vector |

**Note:** Clients are extracted from the `wifi_all` view and filtered to exclude access points (basic_type_set 1 or 9) and any devices already in the AP list.

### Bluetooth Device Object (`bt.devices[]`)

| Field | Type | Description |
|---|---|---|
| `id` | string | SHA-256 hash of salted MAC address (64 hex chars) |
| `name` | string | Device name (max 64 chars, `"(bt)"` if absent) |
| `last_seen` | float | Unix epoch of last detection by Kismet |
| `signal_dbm` | int/null | Raw signal strength in dBm |
| `strength` | float 0-1 | Normalized: `clamp((dBm + 90) / 60, 0, 1)` |

### Telemetry Object

| Field | Type | Description |
|---|---|---|
| `wifi_ap_count` | int | Number of Wi-Fi access points detected |
| `wifi_client_count` | int | Number of Wi-Fi client devices detected |
| `wifi_count` | int | `wifi_ap_count + wifi_client_count` |
| `bt_count` | int | Number of Bluetooth devices detected |
| `total_count` | int | `wifi_count + bt_count` |
| `wifi_mean_rssi` | float | Mean RSSI in dBm across all Wi-Fi devices (default -80 if none) |
| `wifi_rssi_variance` | float | Standard deviation of Wi-Fi RSSI values in dB |
| `ble_ratio` | float 0-1 | Ratio of BT devices to total devices |
| `wifi_burst_rate` | int | Sum of burst_rate across all Wi-Fi APs and clients |

### Notes

- Arrays are sorted by `strength` descending (strongest first)
- The reducer tries multiple Kismet view names for compatibility:
  - Wi-Fi APs: `phy80211_accesspoints`, `phydot11_accesspoints`
  - Wi-Fi All: `phy-IEEE802.11`, `phydot11_all`
  - Bluetooth: `phy-Bluetooth`, `phybluetooth`, `phy-BTLE`, `phybluetooth_le`, `linuxbluetooth`
- Ghost IDs are stable across updates (same device = same hash, salted with per-install random salt stored in `state/salt.txt`)
- The file is written atomically via `.tmp` + `os.replace()` to avoid partial reads

### How the Backend Uses It

The backend (`server.py`) watches this file every 0.2s and pushes it over WebSocket as:

```json
{ "type": "state", "state": { /* full ghost_state content */ } }
```

### Frontend Data Access

The frontend (`app.js`) receives the state and accesses:

- `state.wifi.aps` - Wi-Fi access points
- `state.wifi.clients` - Wi-Fi client devices
- `state.bt.devices` - Bluetooth devices
- `state.telemetry.*` - Aggregate stats for visual effect parameters

---

## power_state.json

Written by `scripts/power_monitor.py` every 5 seconds. Contains battery and AC power status from the X1201 UPS.

### Schema

```json
{
  "voltage": 3.934,
  "soc": 66.4,
  "ac": true,
  "charging": true,
  "ts": 1710085767.0
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `voltage` | float | Battery voltage in volts |
| `soc` | float | State of charge in percent (0-100) |
| `ac` | bool | True if AC power is connected |
| `charging` | bool | True if AC connected and soc < 100 |
| `ts` | float | Unix epoch when this state was written |

---

## WebSocket Message Types

The backend broadcasts several message types over WebSocket:

### State Update

```json
{ "type": "state", "state": { /* ghost_state.json content */ } }
```

Sent every 0.2s when ghost_state.json changes.

### Mode Change

```json
{ "type": "mode", "mode": 2 }
```

Mode: 0 = AP only, 1 = BT only, 2 = Both.

### IMU Orientation

```json
{ "type": "imu", "yaw": 45.2, "pitch": -3.1, "roll": 1.5 }
```

Sent at 50 Hz. Yaw is 0-360 degrees, pitch/roll are +/- degrees.

### Battery Status

```json
{ "type": "battery", "voltage": 3.85, "soc": 72.5 }
```

Sent every 5 seconds.

### Snapshot Trigger

```json
{ "type": "snapshot" }
```

Sent when snapshot button is pressed. Frontend captures and uploads.

### Gallery Toggle

```json
{ "type": "gallery_toggle" }
```

Sent when mode button is pressed. Frontend toggles gallery view.

### LED Status

```json
{ "type": "leds", "power": true, "sense": true }
```

Sent when LED state changes.

### Debug Toggle

```json
{ "type": "debug_toggle" }
```

Sent when mode button is held for 5+ seconds. Toggles debug UI.
