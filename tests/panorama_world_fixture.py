"""Synthetic splat room for real HTTP browser QA; never calls a paid model."""
import math
import struct


def room_bytes():
    points = []

    def point(x, y, z, color):
        values = [x, y, z, *((channel - .5) / .28209479177387814 for channel in color),
                  5, *([math.log(.24)] * 3), 1, 0, 0, 0]
        points.append(struct.pack('<14f', *values))

    for u in range(-12, 13):
        for v in range(-8, 9):
            x, y = u / 3, v / 3
            point(x, y, 4, (.9, .35, .15))
            point(x, y, -4, (.12, .45, .9))
            point(4, y, x, (.15, .8, .35))
            point(-4, y, x, (.8, .65, .2))
            point(x, 3, y * 1.5, (.65, .65, .65))
            point(x, -3, y * 1.5, (.35, .3, .4))
    fields = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
    header = 'ply\nformat binary_little_endian 1.0\nelement vertex ' + str(len(points)) + '\n'
    return (header + ''.join('property float ' + field + '\n' for field in fields) + 'end_header\n').encode() + b''.join(points)
