#!/usr/bin/env python3
"""
LED hardware test — GPIO 5 (power) and GPIO 6 (sense).

Run on the Pi:
    python3 scripts/test/test_leds.py

Optionally override pins via env:
    LED_POWER=5 LED_SENSE=6 python3 scripts/test/test_leds.py
"""
import os
import time

from gpiozero import LED

LED_POWER_PIN = int(os.environ.get("LED_POWER", "5"))
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


def main():
    print(f"Shadow Creatures — LED test")
    print(f"  Power LED  → GPIO {LED_POWER_PIN}")
    print(f"  Sense LED  → GPIO {LED_SENSE_PIN}")

    led_power = LED(LED_POWER_PIN)
    led_sense = LED(LED_SENSE_PIN)

    try:
        # 1. Power LED alone
        section(f"1 / 3  Power LED (GPIO {LED_POWER_PIN})")
        print("  Watch GPIO 5 — should blink 3 times.")
        blink(led_power, f"PWR GPIO{LED_POWER_PIN}")

        time.sleep(0.5)

        # 2. Sense LED alone
        section(f"2 / 3  Sense LED (GPIO {LED_SENSE_PIN})")
        print("  Watch GPIO 6 — should blink 3 times.")
        blink(led_sense, f"SNS GPIO{LED_SENSE_PIN}")

        time.sleep(0.5)

        # 3. Both together
        section("3 / 3  Both LEDs simultaneously")
        print("  Both GPIOs should blink together 3 times.")
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
