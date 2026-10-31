"""Read-only ROI sampling; keep private reference images in world-design.

Usage: python3 tools/extract_reference_palette.py /path/to/targets.json
The target document names an image relative to itself. It records both image
regions and corresponding normalized regions on the rendered material bounds.
"""
import hashlib
import json
import statistics
import sys
from pathlib import Path
from PIL import Image

path = Path(sys.argv[1]).resolve()
config = json.loads(path.read_text())
source = path.parent / config['image']
image = Image.open(source).convert('RGB')
config['source'] = {'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'width': image.width, 'height': image.height,
    'colorSpace': 'sRGB assumed for the supplied PNG; no embedded ICC profile'}
for material in config['materials']:
    for region in material['regions']:
        x, y, width, height = region['imageRect']
        assert 0 <= x < x + width <= image.width and 0 <= y < y + height <= image.height
        pixels = list(image.crop((x, y, x + width, y + height)).getdata())
        rgb = [round(statistics.median(p[c] for p in pixels)) for c in range(3)]
        region['targetRGB'] = rgb
        region['targetHex'] = '#' + ''.join(f'{c:02x}' for c in rgb)
        region['pixelCount'] = len(pixels)
        region['channelRange'] = [[min(p[c] for p in pixels), max(p[c] for p in pixels)] for c in range(3)]
output = path.with_name(path.stem + '-sampled.json')
output.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
print(output)
