#!/usr/bin/env python3
"""
LED hardware test — GPIO 0 (power) and GPIO 6 (sense).

Run on the Pi:
    python3 scripts/test/test_leds.py

Optionally override pins via env:
    LED_POWER=0 LED_SENSE=6 python3 scripts/test/test_leds.py
"""
import os
import time

from gpiozero import LED

LED_POWER_PIN = int(os.environ.get("LED_POWER", "0"))
LED_SENSE_PIN = int(os.environ.get("LED_SENSE", "6"))

BLINK_ON  = 0.3   # seconds LED stays on per blink
BLINK_OFF = 0.2   # seconds LED stays off per blink
BLINKS    = 3     # blinks per test step


def blink(led: LED, label: str, n: int = BLINKS):
    for i in range(n):
        led.on()
        print(f"  [{label}] ON  ({i+1}/{n})")
        time.sleep(BLINK_ON)
        led.off()
        print(f"  [{label}] OFF ({i+1}/{n})")
        time.sleep(BLINK_OFF)


def section(title: str):
    print(f"\n{'='*50}")
    print(f"  {title}")
    print(f"{'='*50}")


def claim_led(pin: int) -> LED:
    try:
        return LED(pin)
    except Exception as e:
        if "busy" in str(e).lower():
            print(f"\nERROR: GPIO {pin} is busy — shadow-backend is likely running.")
            print("Stop it first, then retry:")
            print("    sudo systemctl stop shadow-backend")
        else:
            print(f"\nERROR: could not open GPIO {pin}: {e}")
        raise SystemExit(1)


def main():
    print(f"Shadow Creatures — LED test")
    print(f"  Power LED  → GPIO {LED_POWER_PIN}")
    print(f"  Sense LED  → GPIO {LED_SENSE_PIN}")

    led_power = claim_led(LED_POWER_PIN)
    led_sense = claim_led(LED_SENSE_PIN)

    try:
        # 1. Power LED alone
        section(f"1 / 3  Power LED (GPIO {LED_POWER_PIN})")
        print(f"  Watch GPIO {LED_POWER_PIN} — should blink {BLINKS} times.")
        blink(led_power, f"PWR GPIO{LED_POWER_PIN}")

        time.sleep(0.5)

        # 2. Sense LED alone
        section(f"2 / 3  Sense LED (GPIO {LED_SENSE_PIN})")
        print(f"  Watch GPIO {LED_SENSE_PIN} — should blink {BLINKS} times.")
        blink(led_sense, f"SNS GPIO{LED_SENSE_PIN}")

        time.sleep(0.5)

        # 3. Both together
        section("3 / 3  Both LEDs simultaneously")
        print(f"  Both GPIOs should blink together {BLINKS} times.")
        for i in range(BLINKS):
            led_power.on()
            led_sense.on()
            print(f"  [BOTH] ON  ({i+1}/{BLINKS})")
            time.sleep(BLINK_ON)
            led_power.off()
            led_sense.off()
            print(f"  [BOTH] OFF ({i+1}/{BLINKS})")
            time.sleep(BLINK_OFF)

        print("\nAll tests done. Both LEDs should now be OFF.")

    finally:
        led_power.off()
        led_sense.off()


if __name__ == "__main__":
    main()
