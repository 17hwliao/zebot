import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ART_ROOT = ROOT / 'assets/characters/zenbot'
DOCS_ROOT = ROOT / 'docs/zenbot'
GROUPS = {
    'expressions': 'neutral happy wink love shy surprised angry sad sleepy thinking smug pout worried determined flustered scared excited cry confused'.split(),
    'motions': 'stand jump hop look turn nod shake spin sit sleep dizzy walk run wave bow shiver flap dance'.split(),
}


def font(size, bold=False):
    name = 'arialbd.ttf' if bold else 'arial.ttf'
    return ImageFont.truetype(str(Path('C:/Windows/Fonts') / name), size)


def draw_sheet(group, names):
    sheet = Image.new('RGB', (2400, 2936), '#f1eee6')
    drawing = ImageDraw.Draw(sheet)
    drawing.text((66, 48), f'zenbot {group}', font=font(58, True), fill='#252a3a')
    drawing.text((68, 124), f'{len(names)} individual transparent PNGs | proportional previews | no source resizing', font=font(24), fill='#667085')
    drawing.line((66, 176, 2334, 176), fill='#8fabc6', width=3)
    for index, name in enumerate(names):
        column = index % 5
        row = index // 5
        left = 66 + column * 458
        top = 208 + row * 674
        drawing.rounded_rectangle((left, top, left + 434, top + 650), radius=18, fill='#fcfaf5', outline='#d7d0c3', width=2)
        with Image.open(ART_ROOT / group / f'{name}.png') as source:
            preview = source.convert('RGBA')
            preview.thumbnail((404, 550), Image.Resampling.LANCZOS)
            sheet.paste(preview, (left + (434 - preview.width) // 2, top + 20 + (550 - preview.height) // 2), preview)
        drawing.line((left + 20, top + 586, left + 414, top + 586), fill='#ded8cd', width=1)
        drawing.text((left + 217, top + 617), name, font=font(29, True), fill='#252a3a', anchor='mm')
    sheet.save(DOCS_ROOT / f'{group}-contact-sheet.png')


def inspect_image(path):
    with Image.open(path) as source:
        source.load()
        if source.mode != 'RGBA':
            raise ValueError(f'{path}: expected RGBA, got {source.mode}')
        alpha = source.getchannel('A')
        histogram = alpha.histogram()
        corners = [alpha.getpixel(point) for point in [(0, 0), (source.width - 1, 0), (0, source.height - 1), (source.width - 1, source.height - 1)]]
        bbox = alpha.getbbox()
        if bbox is None or corners != [0, 0, 0, 0] or not histogram[255]:
            raise ValueError(f'{path}: empty image or invalid transparency')
        edges = {
            'left': sum(value > 0 for value in alpha.crop((0, 0, 1, source.height)).getdata()),
            'right': sum(value > 0 for value in alpha.crop((source.width - 1, 0, source.width, source.height)).getdata()),
            'top': sum(value > 0 for value in alpha.crop((0, 0, source.width, 1)).getdata()),
            'bottom': sum(value > 0 for value in alpha.crop((0, source.height - 1, source.width, source.height)).getdata()),
        }
        edge_alpha_max = max(
            alpha.crop((0, 0, 1, source.height)).getextrema()[1],
            alpha.crop((source.width - 1, 0, source.width, source.height)).getextrema()[1],
            alpha.crop((0, 0, source.width, 1)).getextrema()[1],
            alpha.crop((0, source.height - 1, source.width, source.height)).getextrema()[1],
        )
        solid_bbox = alpha.point(lambda value: 255 if value >= 128 else 0).getbbox()
        return {
            'path': path.relative_to(ROOT).as_posix(),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'mode': source.mode,
            'size': list(source.size),
            'alpha_bbox': list(bbox),
            'corner_alpha': corners,
            'transparent_pixel_fraction': round(histogram[0] / (source.width * source.height), 6),
            'nontransparent_edge_pixels': edges,
            'edge_alpha_max': edge_alpha_max,
            'alpha_at_least_128_bbox': list(solid_bbox) if solid_bbox else None,
        }


def main():
    report = {'groups': {}, 'sources': [], 'limits': ['File checks do not establish style, pose, text, or unclipped silhouettes. Visual checks are recorded in PROJECT_STATE.md.']}
    for group, names in GROUPS.items():
        files = [inspect_image(ART_ROOT / group / f'{name}.png') for name in names]
        extras = sorted(path.name for path in (ART_ROOT / group).glob('*.png') if path.stem not in names)
        report['groups'][group] = {'expected': len(names), 'checked': len(files), 'unexpected_pngs': extras, 'files': files}
        draw_sheet(group, names)
    for name in ['zenbot-master.png', 'zenbot-master-trim.png']:
        report['sources'].append(inspect_image(ART_ROOT / 'source' / name))
    diagnostic = Image.new('RGB', (1680, 1120), '#eeeeee')
    drawing = ImageDraw.Draw(diagnostic)
    for index, background in enumerate(['#f4f4f4', '#263044']):
        with Image.open(ART_ROOT / 'source/zenbot-master-trim.png') as source:
            preview = source.copy()
            preview.thumbnail((760, 980), Image.Resampling.LANCZOS)
            panel = Image.new('RGBA', (840, 1040), background)
            panel.alpha_composite(preview, ((840 - preview.width) // 2, 30))
            diagnostic.paste(panel.convert('RGB'), (index * 840, 80))
        drawing.text((index * 840 + 30, 22), f'Master alpha composite: {background}', font=font(28), fill='#252a3a')
    diagnostic.save(DOCS_ROOT / 'master-alpha-check.png')
    report_path = DOCS_ROOT / 'art-validation.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'checked': sum(value['checked'] for value in report['groups'].values()), 'report': str(report_path), 'edge_contacts_at_alpha_128': [item['path'] for value in report['groups'].values() for item in value['files'] if item['edge_alpha_max'] >= 128]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
