#!/usr/bin/env python3
import argparse, hashlib, json, math, os, sys, time
from typing import Any, Dict, List, Optional

import requests

def first_key(d: Dict[str, Any], keys: List[str], default=None):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default

def clamp(x: float, a: float, b: float) -> float:
    return a if x < a else b if x > b else x

def dbm_to_strength(dbm: Optional[float]) -> float:
    if dbm is None:
        return 0.0
    return clamp((dbm + 90.0) / 60.0, 0.0, 1.0)

def stable_hash(salt: str, value: str) -> str:
    h = hashlib.sha256()
    h.update((salt + value).encode("utf-8", errors="ignore"))
    return h.hexdigest()

def fetch_view(session: requests.Session, base: str, view: str, window_s: int) -> Optional[Any]:
    url = f"{base}/devices/views/{view}/last-time/-{window_s}/devices.json"
    r = session.get(url, timeout=4)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()

def normalize_devices(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if "devices" in payload and isinstance(payload["devices"], list):
            return payload["devices"]
        for v in payload.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []

def reduce_wifi_aps(devs: List[Dict[str, Any]], salt: str) -> List[Dict[str, Any]]:
    out = []
    for d in devs:
        mac = first_key(d, ["kismet.device.base.macaddr"], default="unknown")
        name = first_key(d, ["kismet.device.base.name", "kismet.device.base.commonname"], default="(unknown)")
        last_time = first_key(d, ["kismet.device.base.last_time"], default=None)
        channel = first_key(d, ["kismet.device.base.channel"], default=None)
        sig_dbm = first_key(d, ["kismet.common.signal.last_signal_dbm"], default=None)

        # Sum the 60-second packet RRD minute_vec to get packets-per-minute for this AP
        burst_rate = 0
        pkt_rrd = d.get("kismet.device.base.packets.rrd")
        if isinstance(pkt_rrd, dict):
            minute_vec = pkt_rrd.get("kismet.common.rrd.minute_vec")
            if isinstance(minute_vec, list):
                burst_rate = sum(minute_vec)

        hid = stable_hash(salt, str(mac))
        out.append({
            "id": hid,
            "name": str(name)[:64],
            "last_seen": last_time,
            "channel": channel,
            "signal_dbm": sig_dbm,
            "strength": dbm_to_strength(sig_dbm if isinstance(sig_dbm, (int, float)) else None),
            "burst_rate": burst_rate,
        })
    out.sort(key=lambda x: x.get("strength", 0.0), reverse=True)
    return out

def reduce_bt(devs: List[Dict[str, Any]], salt: str) -> List[Dict[str, Any]]:
    out = []
    for d in devs:
        mac = first_key(d, ["kismet.device.base.macaddr"], default="unknown")
        name = first_key(d, ["kismet.device.base.name", "kismet.device.base.commonname"], default="(bt)")
        last_time = first_key(d, ["kismet.device.base.last_time"], default=None)
        sig_dbm = first_key(d, ["kismet.common.signal.last_signal_dbm"], default=None)

        hid = stable_hash(salt, str(mac))
        out.append({
            "id": hid,
            "name": str(name)[:64],
            "last_seen": last_time,
            "signal_dbm": sig_dbm,
            "strength": dbm_to_strength(sig_dbm if isinstance(sig_dbm, (int, float)) else None),
        })
    out.sort(key=lambda x: x.get("strength", 0.0), reverse=True)
    return out

def compute_telemetry(wifi_aps: List[Dict[str, Any]], bt_devices: List[Dict[str, Any]]) -> Dict[str, Any]:
    wifi_count = len(wifi_aps)
    bt_count = len(bt_devices)
    total_count = wifi_count + bt_count

    rssi_vals = [ap["signal_dbm"] for ap in wifi_aps
                 if isinstance(ap.get("signal_dbm"), (int, float))]
    if rssi_vals:
        mean_rssi = sum(rssi_vals) / len(rssi_vals)
        variance = sum((v - mean_rssi) ** 2 for v in rssi_vals) / len(rssi_vals)
        rssi_stddev = math.sqrt(variance)
    else:
        mean_rssi = -80.0
        rssi_stddev = 0.0

    ble_ratio = bt_count / max(1, total_count)

    # Sum minute_vec burst rates across all APs (packets captured in last 60s)
    wifi_burst_rate = sum(ap.get("burst_rate", 0) for ap in wifi_aps)

    return {
        "wifi_count": wifi_count,
        "bt_count": bt_count,
        "total_count": total_count,
        "wifi_mean_rssi": round(mean_rssi, 2),
        "wifi_rssi_variance": round(rssi_stddev, 2),
        "ble_ratio": round(ble_ratio, 4),
        "wifi_burst_rate": wifi_burst_rate,
    }


def atomic_write(path: str, obj: Any):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kismet", default=os.environ.get("KISMET_URL", "http://127.0.0.1:2501"))
    ap.add_argument("--user", default=os.environ.get("KISMET_USER", "shadow"))
    ap.add_argument("--password", default=os.environ.get("KISMET_PASS", ""))
    ap.add_argument("--out", default=os.environ.get("GHOST_STATE_PATH",
                     os.path.expanduser("~/shadow_creatures/state/ghost_state.json")))
    ap.add_argument("--window", type=int, default=60)
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--salt-file", default=os.environ.get("SALT_FILE",
                     os.path.expanduser("~/shadow_creatures/state/salt.txt")))
    args = ap.parse_args()

    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    if not os.path.exists(args.salt_file):
        with open(args.salt_file, "w", encoding="utf-8") as f:
            f.write(os.urandom(16).hex())
    with open(args.salt_file, "r", encoding="utf-8") as f:
        salt = f.read().strip()

    s = requests.Session()
    s.auth = (args.user, args.password)

    wifi_views = ["phy80211_accesspoints", "phydot11_accesspoints"]
    bt_views = ["phybluetooth", "phybluetooth_le", "linuxbluetooth"]

    print("Reducer running. Writing:", args.out)
    while True:
        try:
            ts = time.time()

            wifi_payload = None
            wifi_view_used = None
            for v in wifi_views:
                wifi_payload = fetch_view(s, args.kismet, v, args.window)
                if wifi_payload is not None:
                    wifi_view_used = v
                    break

            bt_payload = None
            bt_view_used = None
            for v in bt_views:
                bt_payload = fetch_view(s, args.kismet, v, args.window)
                if bt_payload is not None:
                    bt_view_used = v
                    break

            wifi_devs = normalize_devices(wifi_payload) if wifi_payload else []
            bt_devs = normalize_devices(bt_payload) if bt_payload else []

            wifi_aps = reduce_wifi_aps(wifi_devs, salt)
            bt_devices = reduce_bt(bt_devs, salt)

            state = {
                "ts": ts,
                "window_s": args.window,
                "views": {"wifi": wifi_view_used, "bt": bt_view_used},
                "wifi": {"aps": wifi_aps},
                "bt": {"devices": bt_devices},
                "telemetry": compute_telemetry(wifi_aps, bt_devices),
            }

            atomic_write(args.out, state)
        except Exception as e:
            print(f"reducer error: {e}", file=sys.stderr)
        time.sleep(args.interval)

if __name__ == "__main__":
    main()
