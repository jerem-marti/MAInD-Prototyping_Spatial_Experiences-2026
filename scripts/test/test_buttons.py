from gpiozero import Button
from signal import pause

b1 = Button(12, pull_up=True, bounce_time=0.05)  # physical 32
b2 = Button(26, pull_up=True, bounce_time=0.05)  # physical 37

b1.when_pressed = lambda: print("Button A")
b2.when_pressed = lambda: print("Button B")

pause()