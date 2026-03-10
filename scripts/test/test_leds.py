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

from gpiozero import LED, PWMLED

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


def claim_led(pin: int, pwm: bool = False):
    try:
        return PWMLED(pin) if pwm else LED(pin)
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
    print(f"  Power LED  → GPIO {LED_POWER_PIN} (digital)")
    print(f"  Sense LED  → GPIO {LED_SENSE_PIN} (PWM)")

    led_power = claim_led(LED_POWER_PIN)
    led_sense = claim_led(LED_SENSE_PIN, pwm=True)

    try:
        # 1. Power LED alone
        section(f"1 / 4  Power LED (GPIO {LED_POWER_PIN})")
        print(f"  Watch GPIO {LED_POWER_PIN} — should blink {BLINKS} times.")
        blink(led_power, f"PWR GPIO{LED_POWER_PIN}")

        time.sleep(0.5)

        # 2. Sense LED alone (blink)
        section(f"2 / 4  Sense LED blink (GPIO {LED_SENSE_PIN})")
        print(f"  Watch GPIO {LED_SENSE_PIN} — should blink {BLINKS} times.")
        blink(led_sense, f"SNS GPIO{LED_SENSE_PIN}")

        time.sleep(0.5)

        # 3. Sense LED pulse test (breathing)
        section(f"3 / 4  Sense LED pulse (GPIO {LED_SENSE_PIN})")
        print("  Slow breathing (1.5s cycle) for 4 seconds...")
        led_sense.pulse(fade_in_time=1.5, fade_out_time=1.5)
        time.sleep(4)
        print("  Fast breathing (0.4s cycle) for 3 seconds...")
        led_sense.pulse(fade_in_time=0.4, fade_out_time=0.4)
        time.sleep(3)
        print("  Rapid breathing (0.2s cycle) for 2 seconds...")
        led_sense.pulse(fade_in_time=0.2, fade_out_time=0.2)
        time.sleep(2)
        led_sense.off()

        time.sleep(0.5)

        # 4. Both together
        section("4 / 4  Both LEDs simultaneously")
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
