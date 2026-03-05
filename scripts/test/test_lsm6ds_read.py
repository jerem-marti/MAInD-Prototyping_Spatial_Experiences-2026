from smbus2 import SMBus
import time

BUS = 1
ADDR = 0x6A

WHO_AM_I = 0x0F
CTRL1_XL = 0x10
CTRL2_G  = 0x11
CTRL3_C  = 0x12

OUTX_L_G  = 0x22  # gyro: 6 bytes
OUTX_L_XL = 0x28  # accel: 6 bytes

def twos_complement_16(lo, hi):
    v = (hi << 8) | lo
    return v - 65536 if v >= 32768 else v

with SMBus(BUS) as bus:
    who = bus.read_byte_data(ADDR, WHO_AM_I)
    print(f"WHO_AM_I = 0x{who:02x} (addr 0x{ADDR:02x})")

    # Enable auto-increment
    bus.write_byte_data(ADDR, CTRL3_C, 0x04)

    # Accel: ODR=104Hz, FS=2g  -> 0x40
    bus.write_byte_data(ADDR, CTRL1_XL, 0x40)

    # Gyro:  ODR=104Hz, FS=245 dps -> 0x40
    bus.write_byte_data(ADDR, CTRL2_G, 0x40)

    time.sleep(0.1)

    # Sensitivities for common defaults (LSM6DS* typical):
    # Accel 2g: 0.061 mg/LSB => 0.000061 g/LSB
    # Gyro 245 dps: 8.75 mdps/LSB => 0.00875 dps/LSB
    ACC_G_PER_LSB = 0.000061
    GYRO_DPS_PER_LSB = 0.00875

    while True:
        g = bus.read_i2c_block_data(ADDR, OUTX_L_G, 6)
        ax = bus.read_i2c_block_data(ADDR, OUTX_L_XL, 6)

        gx = twos_complement_16(g[0], g[1]) * GYRO_DPS_PER_LSB
        gy = twos_complement_16(g[2], g[3]) * GYRO_DPS_PER_LSB
        gz = twos_complement_16(g[4], g[5]) * GYRO_DPS_PER_LSB

        axg = twos_complement_16(ax[0], ax[1]) * ACC_G_PER_LSB
        ayg = twos_complement_16(ax[2], ax[3]) * ACC_G_PER_LSB
        azg = twos_complement_16(ax[4], ax[5]) * ACC_G_PER_LSB

        print(f"acc[g] x={axg:+.3f} y={ayg:+.3f} z={azg:+.3f} | gyro[dps] x={gx:+.1f} y={gy:+.1f} z={gz:+.1f}")
        time.sleep(0.1)