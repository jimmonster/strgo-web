#!/usr/bin/env python3
"""Export typographic sharing covers, never screenshots, using system Cairo.

The resulting PNG files are committed source assets; normal builds do not need
Cairo or this script. Run again after changing project names or English titles.
"""
import ctypes as c
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
library = c.CDLL('libcairo.so.2')


def api(name, result, *args):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = list(args)
    return function


pointer, integer, number, string = c.c_void_p, c.c_int, c.c_double, c.c_char_p
surface_create = api('cairo_image_surface_create', pointer, integer, integer, integer)
create = api('cairo_create', pointer, pointer)
rgb = api('cairo_set_source_rgb', None, pointer, number, number, number)
paint = api('cairo_paint', None, pointer)
move = api('cairo_move_to', None, pointer, number, number)
line = api('cairo_line_to', None, pointer, number, number)
stroke = api('cairo_stroke', None, pointer)
line_width = api('cairo_set_line_width', None, pointer, number)
font_face = api('cairo_select_font_face', None, pointer, string, integer, integer)
font_size = api('cairo_set_font_size', None, pointer, number)
show_text = api('cairo_show_text', None, pointer, string)
write_png = api('cairo_surface_write_to_png', integer, pointer, string)
destroy = api('cairo_destroy', None, pointer)
destroy_surface = api('cairo_surface_destroy', None, pointer)


def export(slug, name, english, accent):
    surface = surface_create(0, 1200, 630)
    canvas = create(surface)
    rgb(canvas, .018, .021, .035)
    paint(canvas)
    line_width(canvas, 1)
    rgb(canvas, .045, .065, .085)
    for x in range(0, 1200, 60):
        move(canvas, x, 0); line(canvas, x, 630); stroke(canvas)
    for y in range(0, 630, 60):
        move(canvas, 0, y); line(canvas, 1200, y); stroke(canvas)
    color = tuple(int(accent[index:index + 2], 16) / 255 for index in (1, 3, 5))
    rgb(canvas, *color)
    line_width(canvas, 3)
    move(canvas, 75, 180); line(canvas, 1125, 180); stroke(canvas)

    def text(value, size, x, y, color):
        rgb(canvas, *color)
        font_face(canvas, b'Noto Sans CJK SC', 0, 0)
        font_size(canvas, size)
        move(canvas, x, y)
        show_text(canvas, value.encode())

    text('STRGO. / SELECTED EXPLORATIONS', 24, 75, 110, color)
    text(name, 76, 75, 325, (.94, .97, 1))
    text(english, 34, 75, 398, (.55, .66, .74))
    text('strgo.com   /   保持好奇，继续创造。', 24, 75, 550, (.53, .66, .70))
    destination = ROOT / 'src/assets/projects' / f'{slug}-share.png'
    destination.parent.mkdir(parents=True, exist_ok=True)
    assert write_png(surface, str(destination).encode()) == 0
    destroy(canvas); destroy_surface(surface)
    print(destination.relative_to(ROOT))


content = json.loads((ROOT / 'content/site-content.json').read_text())
for project in content['projects']:
    export(project['slug'], project['name'], project['englishName'], project['theme'])
export('updates', '最近更新与创作记录', 'Field Notes / A universe in progress', '#00dfd8')
