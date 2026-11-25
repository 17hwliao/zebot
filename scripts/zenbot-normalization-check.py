from pathlib import Path
import json

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ART_ROOT = ROOT / 'assets' / 'characters' / 'zenbot'
DOCS_ROOT = ROOT / 'docs' / 'zenbot'
MANIFEST = json.loads((ART_ROOT / 'manifest.json').read_text(encoding='utf-8'))

VIEW = (-40, -100, 296, 272)
SCALE = 2.4
CELL_W = 760
CELL_H = 900
COLUMNS = 5


def font(size, bold=False):
    name = 'msyhbd.ttc' if bold else 'msyh.ttc'
    return ImageFont.truetype(str(Path('C:/Windows/Fonts') / name), size)


def project(x, y):
    return ((x - VIEW[0]) * SCALE, (y - VIEW[1]) * SCALE)


def place(asset):
    drawing = MANIFEST['drawing']
    logo_width = drawing['logoHeight'] * (drawing['referenceCanvas'][0] / drawing['referenceCanvas'][1])
    with Image.open(ART_ROOT / asset['file']) as source:
        image = source.convert('RGBA')
        scale = logo_width / image.width * asset.get('scale', 1)
        width = image.width * scale
        height = image.height * scale
        x = drawing['centerX'] - width / 2 + asset.get('offsetX', 0)
        y = drawing['feetY'] - height + asset.get('offsetY', 0)
        resized = image.resize((round(width), round(height)), Image.Resampling.LANCZOS)
        return resized, x, y, scale


def render_sheet(title, group):
    items = list(MANIFEST[group].items())
    rows = (len(items) + COLUMNS - 1) // COLUMNS
    sheet = Image.new('RGB', (COLUMNS * CELL_W, rows * CELL_H + 150), '#f2efe7')
    draw = ImageDraw.Draw(sheet)
    draw.text((58, 38), title, font=font(54, True), fill='#242a38')
    draw.text(
        (60, 108),
        'manifest-normalized preview | same logo height, baseline and center',
        font=font(24),
        fill='#687080',
    )

    for index, (name, asset) in enumerate(items):
        column = index % COLUMNS
        row = index // COLUMNS
        left = column * CELL_W
        top = row * CELL_H + 150
        draw.rounded_rectangle(
            (left + 18, top + 12, left + CELL_W - 18, top + CELL_H - 18),
            radius=18,
            fill='#fbf9f4',
            outline='#d8d0c2',
            width=2,
        )

        plane = Image.new('RGBA', (CELL_W - 36, CELL_H - 30), (0, 0, 0, 0))
        plane_draw = ImageDraw.Draw(plane)
        ground = project(0, MANIFEST['drawing']['feetY'])[1] - 12
        center = project(MANIFEST['drawing']['centerX'], 0)[0] - 18
        plane_draw.line((20, ground, CELL_W - 56, ground), fill=(103, 153, 186, 150), width=2)
        plane_draw.line((center, 12, center, ground), fill=(180, 190, 200, 90), width=1)

        image, x, y, scale = place(asset)
        px, py = project(x, y)
        plane.alpha_composite(image, (round(px) - 18, round(py) - 12))
        plane_bg = Image.new('RGB', plane.size, '#fbf9f4')
        plane_bg.paste(plane, (0, 0), plane)
        sheet.paste(plane_bg, (left + 18, top + 12))

        draw.text(
            (left + CELL_W / 2, top + CELL_H - 64),
            name,
            font=font(31, True),
            fill='#242a38',
            anchor='mm',
        )
        draw.text(
            (left + CELL_W / 2, top + CELL_H - 30),
            f'scale x{scale:.3f}',
            font=font(18),
            fill='#7a8190',
            anchor='mm',
        )

    out = DOCS_ROOT / f'{group}-normalization.png'
    sheet.save(out)
    print(out)
    for name, asset in items:
        image, x, y, scale = place(asset)
        print(
            f'{name:8s} scale={scale:.4f} x={x:7.2f} y={y:7.2f} '
            f'w={image.width:4d} h={image.height:4d}'
        )


if __name__ == '__main__':
    DOCS_ROOT.mkdir(parents=True, exist_ok=True)
    render_sheet('zenbot motions | normalized', 'motions')
    render_sheet('zenbot expressions | normalized', 'expressions')
