from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import textwrap
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = Path('/mnt/data/virtual_office_complete_rigged_asset_set_v9_0')
OUT = Path('/mnt/data/virtual_office_complete_product_v10_0')
ZIP_PATH = Path('/mnt/data/virtual_office_complete_product_v10_0.zip')
OVERVIEW = Path('/mnt/data/virtual-office-v10-complete-product-overview.png')

if OUT.exists():
    shutil.rmtree(OUT)
shutil.copytree(SRC, OUT)


def dump_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text).strip() + '\n', encoding='utf-8')


def align4(data: bytearray, pad: int = 0) -> None:
    while len(data) % 4:
        data.append(pad)


# -----------------------------------------------------------------------------
# Procedural seamless PBR texture library
# -----------------------------------------------------------------------------
TEX_ROOT = OUT / '01_runtime_3d' / 'materials_pbr_v10'
TEX_SIZE = 512
rng_global = np.random.default_rng(20260710)


def periodic_noise(size: int, seed: int, octaves: int = 4) -> np.ndarray:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    x = xx / size * 2 * np.pi
    y = yy / size * 2 * np.pi
    out = np.zeros((size, size), np.float32)
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        f = 2 ** o
        phase = rng.random(4) * 2 * np.pi
        term = (
            np.sin(x * f + phase[0]) * np.cos(y * f + phase[1])
            + 0.5 * np.sin((x + y) * f * 0.73 + phase[2])
            + 0.35 * np.cos((x - y) * f * 1.17 + phase[3])
        )
        out += amp * term
        total += amp * 1.85
        amp *= 0.5
    out = out / max(total, 1e-6)
    out = (out - out.min()) / max(out.max() - out.min(), 1e-6)
    return out


def colorize(base: tuple[float, float, float], variation: np.ndarray, strength: float) -> np.ndarray:
    b = np.array(base, dtype=np.float32)[None, None, :]
    v = (variation[..., None] - 0.5) * strength
    return np.clip(b + v, 0, 1)


def normal_from_height(height: np.ndarray, strength: float = 2.0) -> np.ndarray:
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(height)
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
    return np.clip(n * 0.5 + 0.5, 0, 1)


def make_texture_set(
    name: str,
    base: np.ndarray,
    height: np.ndarray,
    roughness: np.ndarray | float,
    metallic: np.ndarray | float,
    alpha: np.ndarray | float = 1.0,
    normal_strength: float = 2.0,
) -> dict[str, Path]:
    folder = TEX_ROOT / name
    folder.mkdir(parents=True, exist_ok=True)
    if np.isscalar(alpha):
        a = np.full((TEX_SIZE, TEX_SIZE), float(alpha), np.float32)
    else:
        a = np.asarray(alpha, np.float32)
    rgba = np.dstack([base, a])
    base_path = folder / f'{name.upper()}_baseColor.png'
    Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA').save(base_path, optimize=True)

    normal = normal_from_height(height, normal_strength)
    normal_path = folder / f'{name.upper()}_normal.png'
    Image.fromarray((normal * 255).astype(np.uint8), 'RGB').save(normal_path, optimize=True)

    if np.isscalar(roughness):
        rough = np.full((TEX_SIZE, TEX_SIZE), float(roughness), np.float32)
    else:
        rough = np.asarray(roughness, np.float32)
    if np.isscalar(metallic):
        metal = np.full((TEX_SIZE, TEX_SIZE), float(metallic), np.float32)
    else:
        metal = np.asarray(metallic, np.float32)
    mr = np.dstack([
        np.ones_like(rough),
        np.clip(rough, 0, 1),
        np.clip(metal, 0, 1),
        np.ones_like(rough),
    ])
    mr_path = folder / f'{name.upper()}_metallicRoughness.png'
    Image.fromarray((mr * 255).astype(np.uint8), 'RGBA').save(mr_path, optimize=True)
    return {'baseColor': base_path, 'normal': normal_path, 'metallicRoughness': mr_path}


def build_pbr_library() -> dict[str, dict[str, Path]]:
    s = TEX_SIZE
    y, x = np.mgrid[0:s, 0:s].astype(np.float32)
    xn, yn = x / s, y / s
    tex: dict[str, dict[str, Path]] = {}

    # Wood light / walnut: periodic grain with knots.
    for name, base_rgb, seed, rough in [
        ('wood_light', (0.58, 0.36, 0.17), 10, 0.46),
        ('wood_walnut', (0.25, 0.12, 0.055), 11, 0.42),
    ]:
        n = periodic_noise(s, seed, 5)
        warp = 0.04 * np.sin(yn * 2 * np.pi * 3 + n * 5)
        grain = 0.5 + 0.5 * np.sin((yn + warp) * 2 * np.pi * 18 + np.sin(xn * 2 * np.pi * 2.0))
        fine = 0.5 + 0.5 * np.sin((yn + warp * 0.3) * 2 * np.pi * 70)
        knots = np.exp(-(((xn - 0.28) / 0.09) ** 2 + ((yn - 0.37) / 0.14) ** 2))
        h = np.clip(0.56 * grain + 0.22 * fine + 0.22 * n - 0.22 * knots, 0, 1)
        base = colorize(base_rgb, h, 0.32)
        roughmap = np.clip(rough + (n - 0.5) * 0.12, 0.25, 0.75)
        tex[name] = make_texture_set(name, base, h, roughmap, 0.0, normal_strength=2.2)

    # Wood slat panel.
    n = periodic_noise(s, 12, 4)
    phase = (xn * 18) % 1
    slat = (phase > 0.12).astype(np.float32)
    groove = np.minimum(phase, 1 - phase)
    h = np.clip(slat * 0.8 + n * 0.2, 0, 1)
    base = np.zeros((s, s, 3), np.float32)
    wood = colorize((0.43, 0.24, 0.10), n, 0.18)
    base[:] = wood
    base[slat < 0.5] = (0.035, 0.03, 0.025)
    rough = np.where(slat > 0.5, 0.43, 0.75)
    tex['wood_slat'] = make_texture_set('wood_slat', base, h, rough, 0.0, normal_strength=4.5)

    # Marble with procedural veins.
    n = periodic_noise(s, 20, 5)
    n2 = periodic_noise(s, 21, 3)
    vein_coord = xn * 2.3 + yn * 0.8 + (n - 0.5) * 0.42
    veins = np.exp(-((np.sin(vein_coord * np.pi * 4.3)) / 0.17) ** 2)
    micro = periodic_noise(s, 22, 5)
    h = np.clip(0.5 + (micro - 0.5) * 0.08 - veins * 0.35, 0, 1)
    base = colorize((0.87, 0.86, 0.83), micro, 0.08)
    base -= veins[..., None] * np.array([0.28, 0.29, 0.31])[None, None, :]
    base = np.clip(base, 0, 1)
    tex['marble_white'] = make_texture_set('marble_white', base, h, 0.24 + (micro - 0.5) * 0.08, 0.0, normal_strength=1.5)

    # Concrete families.
    for name, rgb, seed, rough in [
        ('concrete_dark', (0.22, 0.225, 0.235), 30, 0.72),
        ('concrete_polished', (0.52, 0.50, 0.47), 31, 0.38),
        ('plaster_warm', (0.58, 0.55, 0.51), 32, 0.68),
    ]:
        n = periodic_noise(s, seed, 6)
        speck = (periodic_noise(s, seed + 100, 6) > 0.82).astype(np.float32)
        h = np.clip(0.7 * n + 0.3 * speck, 0, 1)
        base = colorize(rgb, n, 0.12) - speck[..., None] * 0.04
        tex[name] = make_texture_set(name, np.clip(base, 0, 1), h, np.clip(rough + (n - 0.5) * 0.18, 0.2, 0.95), 0.0, normal_strength=2.0)

    # Fabrics.
    fabric_defs = [
        ('fabric_blue', (0.035, 0.12, 0.28), 0.84),
        ('fabric_grey', (0.31, 0.33, 0.36), 0.88),
        ('fabric_navy', (0.035, 0.075, 0.16), 0.82),
        ('fabric_green', (0.12, 0.25, 0.16), 0.84),
        ('fabric_dark', (0.07, 0.08, 0.10), 0.86),
        ('fabric_white', (0.73, 0.72, 0.68), 0.86),
    ]
    weave = (0.5 + 0.5 * np.sin(xn * 2 * np.pi * 96)) * (0.5 + 0.5 * np.sin(yn * 2 * np.pi * 96))
    fn = periodic_noise(s, 40, 4)
    fh = np.clip(0.7 * weave + 0.3 * fn, 0, 1)
    for name, rgb, rough in fabric_defs:
        base = colorize(rgb, fh, 0.09)
        tex[name] = make_texture_set(name, base, fh, rough + (fn - 0.5) * 0.08, 0.0, normal_strength=5.0)

    # Leather.
    n = periodic_noise(s, 50, 6)
    pores = np.clip((periodic_noise(s, 51, 6) - 0.72) * 4, 0, 1)
    h = np.clip(0.75 * n - 0.35 * pores, 0, 1)
    base = colorize((0.025, 0.028, 0.034), h, 0.055)
    tex['leather_black'] = make_texture_set('leather_black', base, h, 0.35 + (n - 0.5) * 0.14, 0.0, normal_strength=3.8)

    # Metals and plastics.
    brushed = 0.5 + 0.5 * np.sin(yn * 2 * np.pi * 170 + periodic_noise(s, 60, 3) * 3)
    bn = periodic_noise(s, 61, 5)
    h = np.clip(0.75 * brushed + 0.25 * bn, 0, 1)
    tex['metal_chrome'] = make_texture_set('metal_chrome', colorize((0.58, 0.60, 0.62), h, 0.18), h, 0.22 + (bn - 0.5) * 0.08, 0.92, normal_strength=1.8)
    tex['metal_black'] = make_texture_set('metal_black', colorize((0.025, 0.032, 0.045), bn, 0.045), bn, 0.28 + (bn - 0.5) * 0.08, 0.78, normal_strength=1.1)
    for name, rgb, rough in [
        ('plastic_black', (0.025, 0.03, 0.04), 0.43),
        ('plastic_white', (0.72, 0.73, 0.73), 0.42),
        ('ceramic_white', (0.82, 0.82, 0.79), 0.25),
    ]:
        n = periodic_noise(s, hash(name) & 0xffff, 5)
        tex[name] = make_texture_set(name, colorize(rgb, n, 0.035), n, rough + (n - 0.5) * 0.06, 0.0, normal_strength=0.8)

    # Paper and skin.
    n = periodic_noise(s, 70, 5)
    tex['paper'] = make_texture_set('paper', colorize((0.82, 0.80, 0.73), n, 0.05), n, 0.84, 0.0, normal_strength=0.55)
    for name, rgb, seed in [('skin_light', (0.69, 0.47, 0.36), 71), ('skin_medium', (0.45, 0.28, 0.18), 72)]:
        n = periodic_noise(s, seed, 6)
        pores = np.clip((periodic_noise(s, seed + 50, 6) - 0.76) * 3, 0, 1)
        h = np.clip(0.85 * n - pores * 0.2, 0, 1)
        tex[name] = make_texture_set(name, colorize(rgb, n, 0.045), h, 0.5 + (n - 0.5) * 0.06, 0.0, normal_strength=0.75)

    # Hair.
    for name, rgb, seed in [('hair_brown', (0.10, 0.045, 0.018), 80), ('hair_black', (0.012, 0.014, 0.018), 81)]:
        n = periodic_noise(s, seed, 4)
        strands = 0.5 + 0.5 * np.sin(yn * 2 * np.pi * 120 + n * 3)
        h = np.clip(0.65 * strands + 0.35 * n, 0, 1)
        tex[name] = make_texture_set(name, colorize(rgb, h, 0.04), h, 0.44 + (n - 0.5) * 0.1, 0.0, normal_strength=2.0)

    # Plants.
    for name, rgb, seed in [('leaf_light', (0.08, 0.29, 0.09), 90), ('leaf_deep', (0.018, 0.12, 0.035), 91), ('stem', (0.11, 0.18, 0.055), 92)]:
        n = periodic_noise(s, seed, 5)
        veins = 0.5 + 0.5 * np.cos((xn - 0.5) * np.pi * 9 + np.sin(yn * np.pi * 2))
        h = np.clip(0.6 * n + 0.4 * veins, 0, 1)
        tex[name] = make_texture_set(name, colorize(rgb, h, 0.10), h, 0.62 + (n - 0.5) * 0.12, 0.0, normal_strength=2.3)

    # Carpet.
    n = periodic_noise(s, 100, 5)
    weave2 = (0.5 + 0.5 * np.sin((xn + yn) * 2 * np.pi * 72)) * (0.5 + 0.5 * np.sin((xn - yn) * 2 * np.pi * 72))
    h = np.clip(0.6 * weave2 + 0.4 * n, 0, 1)
    tex['carpet_blue'] = make_texture_set('carpet_blue', colorize((0.055, 0.11, 0.19), h, 0.12), h, 0.93, 0.0, normal_strength=5.5)

    # Screen / wall art / poster.
    screen = np.zeros((s, s, 3), np.float32)
    screen[..., :] = (0.006, 0.018, 0.04)
    screen += (0.02 + 0.05 * (1 - yn))[..., None] * np.array([0.1, 0.4, 1.0])[None, None, :]
    for i in range(6):
        y0 = int(s * (0.15 + i * 0.1))
        screen[y0:y0+2, int(s*0.12):int(s*0.88), :] += np.array([0.08, 0.18, 0.4])
    chart = 0.5 + 0.35 * np.sin(xn * 2 * np.pi * 2.2) + 0.12 * np.sin(xn * 2 * np.pi * 7)
    for ix in range(s):
        iy = int(np.clip((1 - chart[0, ix]) * s, 0, s - 1))
        screen[max(0, iy-2):min(s, iy+3), ix, :] = (0.12, 0.5, 1.0)
    tex['screen'] = make_texture_set('screen', np.clip(screen, 0, 1), periodic_noise(s, 110, 3), 0.22, 0.0, normal_strength=0.2)

    art = np.zeros((s, s, 3), np.float32)
    art[:] = (0.62, 0.59, 0.52)
    masks = [
        (xn + yn < 0.95),
        ((xn - 0.35) ** 2 + (yn - 0.45) ** 2 < 0.15),
        ((xn > 0.55) & (yn > 0.3)),
    ]
    colors = [(0.07, 0.12, 0.20), (0.12, 0.28, 0.47), (0.76, 0.69, 0.54)]
    for mask, col in zip(masks, colors): art[mask] = col
    tex['wall_art'] = make_texture_set('wall_art', art, periodic_noise(s, 111, 3), 0.65, 0.0, normal_strength=0.4)

    # Accent signal colors, emissive, water.
    flat_defs = [
        ('accent_yellow', (0.92, 0.58, 0.04), 0.36, 0.0),
        ('signal_red', (0.66, 0.035, 0.025), 0.36, 0.0),
        ('online_green', (0.05, 0.72, 0.22), 0.28, 0.0),
        ('emissive_blue', (0.025, 0.30, 1.0), 0.12, 0.0),
        ('emissive_warm', (1.0, 0.48, 0.16), 0.18, 0.0),
        ('soft_white', (0.86, 0.84, 0.78), 0.48, 0.0),
    ]
    for i, (name, rgb, rough, metal) in enumerate(flat_defs):
        n = periodic_noise(s, 120 + i, 3)
        tex[name] = make_texture_set(name, colorize(rgb, n, 0.025), n, rough, metal, normal_strength=0.25)

    n = periodic_noise(s, 140, 4)
    water_base = colorize((0.04, 0.28, 0.55), n, 0.08)
    tex['water'] = make_texture_set('water', water_base, n, 0.08, 0.0, alpha=0.45, normal_strength=3.2)
    tex['glass'] = make_texture_set('glass', np.full((s, s, 3), (0.72, 0.88, 0.96), np.float32), periodic_noise(s, 141, 3), 0.08, 0.0, alpha=0.18, normal_strength=0.18)

    return tex


TEXTURES = build_pbr_library()


def classify_material(name: str) -> tuple[str, float, dict[str, Any]]:
    n = name.upper()
    props: dict[str, Any] = {}
    scale = 1.5
    if 'GLASS' in n:
        props.update({'glass': True})
        return 'glass', 1.0, props
    if 'WATER' in n:
        props.update({'glass': True, 'water': True})
        return 'water', 1.8, props
    if 'NEON_BLUE' in n or 'BLUE_EMISSIVE' in n:
        props.update({'emissive': [0.03, 0.35, 1.0], 'emissive_strength': 8.0})
        return 'emissive_blue', 1.0, props
    if 'NEON_WARM' in n or 'WARM_EMISSIVE' in n:
        props.update({'emissive': [1.0, 0.38, 0.10], 'emissive_strength': 5.0})
        return 'emissive_warm', 1.0, props
    if 'SCREEN' in n or 'ROOM_LABEL' in n or 'NAME_' in n:
        props.update({'emissive': [0.12, 0.32, 1.0], 'emissive_strength': 2.2})
        return 'screen', 1.0, props
    if 'LOGO' in n:
        props.update({'emissive': [1.0, 0.92, 0.78], 'emissive_strength': 3.0})
        return 'soft_white', 1.0, props
    if 'WOOD_SLAT' in n:
        return 'wood_slat', 0.85, props
    if 'WOOD_WALNUT' in n or 'WOOD_DARK' in n:
        return 'wood_walnut', 1.2, props
    if 'WOOD' in n:
        return 'wood_light', 1.2, props
    if 'MARBLE' in n:
        return 'marble_white', 0.7, props
    if 'CONCRETE_POLISHED' in n:
        return 'concrete_polished', 1.0, props
    if 'CONCRETE' in n or 'POT_GREY' in n:
        return 'concrete_dark', 1.0, props
    if 'CARPET' in n or 'RUG' in n:
        return 'carpet_blue', 4.0, props
    if 'FABRIC_BLUE' in n:
        return 'fabric_blue', 5.0, props
    if 'FABRIC_GREY' in n:
        return 'fabric_grey', 5.0, props
    if 'CLOTH_NAVY' in n or 'SHIRT_NAVY' in n:
        return 'fabric_navy', 6.0, props
    if 'CLOTH_GREEN' in n or 'SHIRT_GREEN' in n:
        return 'fabric_green', 6.0, props
    if 'CLOTH_DARK' in n or 'PANTS_DARK' in n:
        return 'fabric_dark', 6.0, props
    if 'CLOTH_WHITE' in n:
        return 'fabric_white', 6.0, props
    if 'LEATHER' in n:
        return 'leather_black', 4.0, props
    if 'METAL_CHROME' in n:
        return 'metal_chrome', 3.0, props
    if 'METAL' in n or 'DARK_METAL' in n:
        return 'metal_black', 3.0, props
    if 'PLASTIC_WHITE' in n:
        return 'plastic_white', 3.0, props
    if 'PLASTIC' in n or 'BLACK_PLASTIC' in n:
        return 'plastic_black', 3.0, props
    if 'CERAMIC' in n:
        return 'ceramic_white', 2.5, props
    if 'PAPER' in n:
        return 'paper', 4.0, props
    if 'SKIN_LIGHT' in n:
        return 'skin_light', 6.0, props
    if 'SKIN_MEDIUM' in n:
        return 'skin_medium', 6.0, props
    if 'HAIR_BROWN' in n:
        return 'hair_brown', 6.0, props
    if 'HAIR' in n:
        return 'hair_black', 6.0, props
    if 'PLANT_LEAF_DEEP' in n:
        return 'leaf_deep', 5.0, props
    if 'PLANT_LEAF' in n or 'GREEN_LEAF' in n:
        return 'leaf_light', 5.0, props
    if 'PLANT_STEM' in n:
        return 'stem', 5.0, props
    if 'WALL_ART' in n or 'POSTER' in n:
        return 'wall_art', 1.0, props
    if 'ACCENT_YELLOW' in n:
        return 'accent_yellow', 1.0, props
    if 'SIGNAL_RED' in n:
        return 'signal_red', 1.0, props
    if 'ONLINE_GREEN' in n:
        return 'online_green', 1.0, props
    if 'SOFT_WHITE' in n:
        return 'soft_white', 2.0, props
    return 'plastic_white', 2.0, props


# -----------------------------------------------------------------------------
# GLB parser / PBR patcher
# -----------------------------------------------------------------------------
COMPONENT_DTYPES = {
    5120: np.dtype('<i1'), 5121: np.dtype('<u1'), 5122: np.dtype('<i2'),
    5123: np.dtype('<u2'), 5125: np.dtype('<u4'), 5126: np.dtype('<f4'),
}
TYPE_COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def read_glb(path: Path) -> tuple[dict[str, Any], bytearray]:
    raw = path.read_bytes()
    if len(raw) < 20 or raw[:4] != b'glTF':
        raise ValueError(f'Invalid GLB: {path}')
    _, version, declared = struct.unpack_from('<4sII', raw, 0)
    if version != 2 or declared != len(raw):
        raise ValueError(f'Invalid GLB header: {path}')
    offset = 12
    json_data: dict[str, Any] | None = None
    bin_data = bytearray()
    while offset + 8 <= len(raw):
        length, ctype = struct.unpack_from('<II', raw, offset)
        offset += 8
        chunk = raw[offset:offset+length]
        offset += length
        if ctype == 0x4E4F534A:
            json_data = json.loads(chunk.rstrip(b'\x00\x20\t\r\n').decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_data = bytearray(chunk)
    if json_data is None:
        raise ValueError('Missing JSON chunk')
    declared_bin = json_data.get('buffers', [{}])[0].get('byteLength', len(bin_data))
    bin_data = bin_data[:declared_bin]
    return json_data, bin_data


def accessor_array(data: dict[str, Any], bin_data: bytearray, accessor_index: int) -> np.ndarray:
    acc = data['accessors'][accessor_index]
    bv = data['bufferViews'][acc['bufferView']]
    dtype = COMPONENT_DTYPES[acc['componentType']]
    comps = TYPE_COMPONENTS[acc['type']]
    count = int(acc['count'])
    base_offset = int(bv.get('byteOffset', 0)) + int(acc.get('byteOffset', 0))
    packed = dtype.itemsize * comps
    stride = int(bv.get('byteStride', packed))
    if stride == packed:
        arr = np.frombuffer(bin_data, dtype=dtype, count=count * comps, offset=base_offset).reshape(count, comps)
        return arr.copy()
    arr = np.empty((count, comps), dtype=dtype)
    for i in range(count):
        arr[i] = np.frombuffer(bin_data, dtype=dtype, count=comps, offset=base_offset + i * stride)
    return arr


def append_accessor(
    data: dict[str, Any], bin_data: bytearray, arr: np.ndarray, accessor_type: str,
    target: int | None = 34962,
) -> int:
    align4(bin_data)
    arr = np.ascontiguousarray(arr.astype('<f4'))
    offset = len(bin_data)
    raw = arr.tobytes()
    bin_data.extend(raw)
    bv: dict[str, Any] = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw)}
    if target is not None:
        bv['target'] = target
    data.setdefault('bufferViews', []).append(bv)
    bv_index = len(data['bufferViews']) - 1
    acc: dict[str, Any] = {
        'bufferView': bv_index,
        'componentType': 5126,
        'count': int(arr.shape[0]),
        'type': accessor_type,
    }
    if arr.size:
        acc['min'] = arr.min(axis=0).astype(float).tolist()
        acc['max'] = arr.max(axis=0).astype(float).tolist()
    data.setdefault('accessors', []).append(acc)
    return len(data['accessors']) - 1


def append_image(data: dict[str, Any], bin_data: bytearray, png_path: Path, name: str) -> int:
    align4(bin_data)
    payload = png_path.read_bytes()
    offset = len(bin_data)
    bin_data.extend(payload)
    data.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)})
    bv_index = len(data['bufferViews']) - 1
    data.setdefault('images', []).append({'name': name, 'bufferView': bv_index, 'mimeType': 'image/png'})
    return len(data['images']) - 1


def compute_normals_uv(positions: np.ndarray, indices: np.ndarray, scale: float) -> tuple[np.ndarray, np.ndarray]:
    pos = positions.astype(np.float32)
    idx = indices.reshape(-1).astype(np.int64)
    normals = np.zeros_like(pos)
    tri_count = len(idx) // 3
    if tri_count:
        tris = idx[:tri_count * 3].reshape(-1, 3)
        valid = np.all((tris >= 0) & (tris < len(pos)), axis=1)
        tris = tris[valid]
        if len(tris):
            e1 = pos[tris[:, 1]] - pos[tris[:, 0]]
            e2 = pos[tris[:, 2]] - pos[tris[:, 0]]
            face = np.cross(e1, e2)
            flen = np.linalg.norm(face, axis=1, keepdims=True)
            good = flen[:, 0] > 1e-9
            face[good] /= flen[good]
            face[~good] = 0
            np.add.at(normals, tris[:, 0], face)
            np.add.at(normals, tris[:, 1], face)
            np.add.at(normals, tris[:, 2], face)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    fallback = lengths[:, 0] < 1e-8
    normals[~fallback] /= lengths[~fallback]
    normals[fallback] = np.array([0, 0, 1], np.float32)

    absn = np.abs(normals)
    dominant = np.argmax(absn, axis=1)
    uv = np.zeros((len(pos), 2), np.float32)
    # X-dominant: Y/Z, Y-dominant: X/Z, Z-dominant: X/Y.
    mask = dominant == 0
    uv[mask, 0] = pos[mask, 1] * scale
    uv[mask, 1] = pos[mask, 2] * scale
    mask = dominant == 1
    uv[mask, 0] = pos[mask, 0] * scale
    uv[mask, 1] = pos[mask, 2] * scale
    mask = dominant == 2
    uv[mask, 0] = pos[mask, 0] * scale
    uv[mask, 1] = pos[mask, 1] * scale
    return normals, uv


def write_glb(path: Path, data: dict[str, Any], bin_data: bytearray) -> None:
    data['buffers'][0]['byteLength'] = len(bin_data)
    json_bytes = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4:
        json_bytes += b' '
    bin_bytes = bytes(bin_data)
    while len(bin_bytes) % 4:
        bin_bytes += b'\x00'
    total = 12 + 8 + len(json_bytes) + (8 + len(bin_bytes) if bin_bytes else 0)
    out = bytearray(struct.pack('<4sII', b'glTF', 2, total))
    out.extend(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    out.extend(json_bytes)
    if bin_bytes:
        out.extend(struct.pack('<II', len(bin_bytes), 0x004E4942))
        out.extend(bin_bytes)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)


def enhance_glb(src: Path, dst: Path) -> dict[str, Any]:
    data, bin_data = read_glb(src)
    data.setdefault('asset', {})['generator'] = 'Virtual Office Complete Product v10 PBR Enhancer'
    data['asset']['extras'] = {
        **(data['asset'].get('extras') or {}),
        'virtualOfficeVersion': '10.0',
        'embeddedPBR': True,
    }
    sampler_index = None
    texture_indices: dict[tuple[str, str], int] = {}
    material_classes: dict[int, tuple[str, float, dict[str, Any]]] = {}
    for mi, material in enumerate(data.get('materials', [])):
        material_classes[mi] = classify_material(material.get('name', ''))

    # Add missing normals and UVs, with material-specific tiling scale.
    normals_added = 0
    uvs_added = 0
    for mesh in data.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if prim.get('mode', 4) != 4:
                continue
            attrs = prim.setdefault('attributes', {})
            pos_idx = attrs.get('POSITION')
            if not isinstance(pos_idx, int):
                continue
            positions = accessor_array(data, bin_data, pos_idx).astype(np.float32)
            if 'indices' in prim:
                indices = accessor_array(data, bin_data, int(prim['indices'])).reshape(-1)
            else:
                indices = np.arange(len(positions), dtype=np.uint32)
            mat_idx = int(prim.get('material', 0))
            _, scale, _ = material_classes.get(mat_idx, ('plastic_white', 2.0, {}))
            normals, uv = compute_normals_uv(positions, indices, scale)
            if 'NORMAL' not in attrs:
                attrs['NORMAL'] = append_accessor(data, bin_data, normals, 'VEC3')
                normals_added += 1
            if 'TEXCOORD_0' not in attrs:
                attrs['TEXCOORD_0'] = append_accessor(data, bin_data, uv, 'VEC2')
                uvs_added += 1

    # Shared sampler.
    if data.get('materials'):
        data.setdefault('samplers', []).append({
            'name': 'VO_V10_REPEAT_ANISO',
            'magFilter': 9729,
            'minFilter': 9987,
            'wrapS': 10497,
            'wrapT': 10497,
        })
        sampler_index = len(data['samplers']) - 1

    def get_texture(set_name: str, kind: str) -> int:
        key = (set_name, kind)
        if key in texture_indices:
            return texture_indices[key]
        img_idx = append_image(data, bin_data, TEXTURES[set_name][kind], f'{set_name}_{kind}')
        data.setdefault('textures', []).append({
            'name': f'{set_name}_{kind}',
            'sampler': sampler_index,
            'source': img_idx,
        })
        tex_idx = len(data['textures']) - 1
        texture_indices[key] = tex_idx
        return tex_idx

    ext_used = set(data.get('extensionsUsed', []))
    for mi, material in enumerate(data.get('materials', [])):
        set_name, _, props = material_classes[mi]
        pbr = material.setdefault('pbrMetallicRoughness', {})
        pbr['baseColorTexture'] = {'index': get_texture(set_name, 'baseColor')}
        pbr['metallicRoughnessTexture'] = {'index': get_texture(set_name, 'metallicRoughness')}
        material['normalTexture'] = {'index': get_texture(set_name, 'normal'), 'scale': 0.75}
        pbr['baseColorFactor'] = [1.0, 1.0, 1.0, float(pbr.get('baseColorFactor', [1, 1, 1, 1])[3])]
        pbr['roughnessFactor'] = 1.0
        pbr['metallicFactor'] = 1.0
        if props.get('glass'):
            material['alphaMode'] = 'BLEND'
            material['doubleSided'] = True
            pbr['baseColorFactor'][3] = 0.18 if not props.get('water') else 0.45
            material.setdefault('extensions', {})['KHR_materials_transmission'] = {'transmissionFactor': 0.88 if not props.get('water') else 0.68}
            material['extensions']['KHR_materials_ior'] = {'ior': 1.45 if not props.get('water') else 1.333}
            material['extensions']['KHR_materials_volume'] = {
                'thicknessFactor': 0.02,
                'attenuationDistance': 8.0,
                'attenuationColor': [0.72, 0.9, 1.0] if not props.get('water') else [0.2, 0.55, 0.9],
            }
            ext_used.update({'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_volume'})
        if 'emissive' in props:
            material['emissiveFactor'] = props['emissive']
            material['emissiveTexture'] = {'index': get_texture(set_name, 'baseColor')}
            material.setdefault('extensions', {})['KHR_materials_emissive_strength'] = {
                'emissiveStrength': props.get('emissive_strength', 2.0)
            }
            ext_used.add('KHR_materials_emissive_strength')
    if ext_used:
        data['extensionsUsed'] = sorted(ext_used)

    write_glb(dst, data, bin_data)
    return {
        'source': str(src),
        'output': str(dst),
        'materials': len(data.get('materials', [])),
        'embedded_images': len(data.get('images', [])),
        'textures': len(data.get('textures', [])),
        'normals_added': normals_added,
        'uv_sets_added': uvs_added,
        'bytes': dst.stat().st_size,
    }


# Enhance all model and scene GLBs.
PBR_MODEL_ROOT = OUT / '01_runtime_3d' / 'models_pbr_v10'
PBR_SCENE_ROOT = OUT / '01_runtime_3d' / 'scenes_pbr_v10'
if PBR_MODEL_ROOT.exists(): shutil.rmtree(PBR_MODEL_ROOT)
if PBR_SCENE_ROOT.exists(): shutil.rmtree(PBR_SCENE_ROOT)

pbr_reports: list[dict[str, Any]] = []
model_src_root = OUT / '01_runtime_3d' / 'models'
for src in sorted(model_src_root.rglob('*.glb')):
    dst = PBR_MODEL_ROOT / src.relative_to(model_src_root)
    pbr_reports.append(enhance_glb(src, dst))
scene_src_root = OUT / '01_runtime_3d' / 'scenes'
for src in sorted(scene_src_root.glob('*.glb')):
    dst = PBR_SCENE_ROOT / src.name
    pbr_reports.append(enhance_glb(src, dst))

# -----------------------------------------------------------------------------
# Registries and presets
# -----------------------------------------------------------------------------
registry_v9 = json.loads((OUT / '05_registries' / 'asset-registry-v9.json').read_text(encoding='utf-8'))
assets_v10 = []
report_by_source = {Path(r['source']).resolve(): r for r in pbr_reports}
for asset in registry_v9.get('assets', []):
    item = json.loads(json.dumps(asset))
    file = item.get('file', '')
    if file.startswith('01_runtime_3d/models/') and file.endswith('.glb'):
        enhanced = file.replace('01_runtime_3d/models/', '01_runtime_3d/models_pbr_v10/', 1)
        item['legacy_file'] = file
        item['file'] = enhanced
        src_abs = (OUT / file).resolve()
        rep = report_by_source.get(src_abs)
        item['pbr_v10'] = {
            'embedded': True,
            'uv0': True,
            'normals': True,
            'texture_maps': ['baseColor', 'normal', 'metallicRoughness'],
            'embedded_image_count': rep['embedded_images'] if rep else None,
        }
    elif file.startswith('01_runtime_3d/scenes/') and file.endswith('.glb'):
        enhanced = file.replace('01_runtime_3d/scenes/', '01_runtime_3d/scenes_pbr_v10/', 1)
        item['legacy_file'] = file
        item['file'] = enhanced
        item['pbr_v10'] = {'embedded': True, 'uv0': True, 'normals': True}
    assets_v10.append(item)

category_counts = Counter(a.get('category', 'unknown') for a in assets_v10)
registry_v10 = {
    'version': '10.0',
    'name': 'Virtual Office Complete Product v10.0',
    'asset_count': len(assets_v10),
    'category_counts': dict(sorted(category_counts.items())),
    'primary_asset_tier': 'PBR_EMBEDDED_V10',
    'runtime_capabilities': {
        'individual_asset_placement': True,
        'grid_snap_editor': True,
        'layout_save_load': True,
        'click_to_move': True,
        'grid_astar_pathfinding': True,
        'collision_avoidance': True,
        'seat_and_work_anchors': True,
        'animation_state_machine': True,
        'embedded_character_clips': 12,
    },
    'assets': assets_v10,
}
dump_json(OUT / '05_registries' / 'asset-registry-v10.json', registry_v10)

with (OUT / '05_registries' / 'asset-catalog-v10.csv').open('w', newline='', encoding='utf-8-sig') as f:
    fieldnames = ['asset_id', 'category', 'type', 'priority', 'file', 'legacy_file', 'width_m', 'depth_m', 'height_m', 'runtime_ready']
    w = csv.DictWriter(f, fieldnames=fieldnames)
    w.writeheader()
    for a in assets_v10:
        d = a.get('dimensions_m', {})
        w.writerow({
            'asset_id': a.get('asset_id'), 'category': a.get('category'), 'type': a.get('type'),
            'priority': a.get('priority'), 'file': a.get('file'), 'legacy_file': a.get('legacy_file', ''),
            'width_m': d.get('width', ''), 'depth_m': d.get('depth', ''), 'height_m': d.get('height', ''),
            'runtime_ready': a.get('runtime_ready', False),
        })

material_registry = {
    'version': '10.0',
    'texture_resolution': TEX_SIZE,
    'maps': ['baseColor', 'normal', 'metallicRoughness'],
    'sets': [
        {
            'material_id': name.upper(),
            'folder': str(paths['baseColor'].parent.relative_to(OUT).as_posix()),
            'baseColor': str(paths['baseColor'].relative_to(OUT).as_posix()),
            'normal': str(paths['normal'].relative_to(OUT).as_posix()),
            'metallicRoughness': str(paths['metallicRoughness'].relative_to(OUT).as_posix()),
        }
        for name, paths in sorted(TEXTURES.items())
    ],
}
dump_json(OUT / '05_registries' / 'material-registry-v10.json', material_registry)

# A concise asset palette for the runtime editor.
preferred_ids = [
    'RECEPTION_DESK_MARBLE_HERO_001', 'RECEPTION_BACKWALL_WOOD_SLAT_HERO_001',
    'DESK_STANDARD_001', 'DESK_L_CORNER_001', 'DESK_BENCH_4P_HERO_001',
    'CHAIR_TASK_BLACK_HERO_001', 'CHAIR_EXECUTIVE_HIGHBACK_001',
    'ARCH_GLASS_MEETING_ROOM_HERO_001', 'MEETING_TABLE_8P_HERO_001', 'MEETING_CHAIR_BLACK_001',
    'MEETING_TV_WALL_001', 'MEETING_WHITEBOARD_WALL_001',
    'SOFA_SECTIONAL_BLUE_HERO_001', 'LOUNGE_CHAIR_ROUND_001', 'TABLE_COFFEE_ROUND_001', 'RUG_BLUE_PATTERN_001',
    'PHONEBOOTH_1P_GLASS_001', 'FOCUS_POD_001',
    'PANTRY_COUNTER_MARBLE_HERO_001', 'BAR_STOOL_BLUE_001', 'COFFEE_MACHINE_001', 'WATER_DISPENSER_001',
    'SHELF_OPEN_001', 'CABINET_FILE_001', 'PRINTER_MFP_001',
    'PLANT_LARGE_REALISTIC_HERO_001', 'PLANT_MEDIUM_001', 'PLANT_SMALL_DESK_001',
    'ARCH_WALL_SEGMENT_CONCRETE_001', 'ARCH_GLASS_PARTITION_001', 'ARCH_GLASS_DOOR_001',
    'LIGHT_PENDANT_WARM_001', 'LIGHT_CEILING_PANEL_001',
]
asset_index = {a.get('asset_id'): a for a in assets_v10}
palette = [asset_index[i] for i in preferred_ids if i in asset_index]
dump_json(OUT / '12_layout_presets' / 'asset-palette-v10.json', {'version': '10.0', 'assets': palette})

# Layout presets. XY = floor plane, Z = vertical.
layouts = {
    'PRESET_OPEN_OFFICE_V10_001': {
        'name': 'Open Office HQ',
        'bounds': [-6.5, -4.5, 6.5, 4.5],
        'instances': [
            ['RECEPTION_BACKWALL_WOOD_SLAT_HERO_001', [-4.7, 2.7, 0], 0],
            ['RECEPTION_DESK_MARBLE_HERO_001', [-4.6, 1.7, 0], 0],
            ['LOBBY_DECOR_SHELF_001', [-2.9, 3.0, 0], 0],
            ['SOFA_SECTIONAL_BLUE_HERO_001', [-2.8, 2.2, 0], 180],
            ['TABLE_COFFEE_ROUND_001', [-2.2, 1.2, 0], 0],
            ['DESK_BENCH_4P_HERO_001', [-0.9, -0.1, 0], 0],
            ['DESK_BENCH_4P_HERO_001', [1.1, -1.1, 0], 180],
            ['ARCH_GLASS_MEETING_ROOM_HERO_001', [3.4, 1.9, 0], 0],
            ['MEETING_TABLE_8P_HERO_001', [3.4, 1.9, 0], 0],
            ['MEETING_TV_WALL_001', [5.4, 2.1, 0], 90],
            ['PANTRY_COUNTER_MARBLE_HERO_001', [-3.8, -2.8, 0], 0],
            ['BAR_STOOL_BLUE_001', [-4.6, -1.9, 0], 0],
            ['BAR_STOOL_BLUE_001', [-3.8, -1.9, 0], 0],
            ['BAR_STOOL_BLUE_001', [-3.0, -1.9, 0], 0],
            ['PHONEBOOTH_1P_GLASS_001', [4.9, -2.8, 0], 0],
            ['PLANT_LARGE_REALISTIC_HERO_001', [-5.8, 3.5, 0], 0],
            ['PLANT_LARGE_REALISTIC_HERO_001', [5.6, 3.5, 0], 0],
            ['PLANT_MEDIUM_001', [2.1, 3.3, 0], 0],
            ['PLANT_MEDIUM_001', [5.7, -3.5, 0], 0],
        ],
        'avatar_spawn': [0, -3.2, 0],
    },
    'PRESET_COMPACT_STARTUP_V10_001': {
        'name': 'Compact Startup',
        'bounds': [-5, -3.5, 5, 3.5],
        'instances': [
            ['RECEPTION_DESK_MARBLE_HERO_001', [-3.6, 2.1, 0], 0],
            ['DESK_BENCH_4P_HERO_001', [-0.8, 0.1, 0], 0],
            ['ARCH_GLASS_MEETING_ROOM_HERO_001', [2.7, 1.4, 0], 0],
            ['MEETING_TABLE_4P_001', [2.7, 1.4, 0], 0],
            ['SOFA_2SEAT_001', [-2.8, -1.6, 0], 0],
            ['TABLE_COFFEE_ROUND_001', [-1.8, -1.6, 0], 0],
            ['PANTRY_COUNTER_MARBLE_HERO_001', [2.7, -2.2, 0], 180],
            ['PLANT_LARGE_REALISTIC_HERO_001', [-4.4, 2.8, 0], 0],
            ['PLANT_MEDIUM_001', [4.2, -2.8, 0], 0],
        ],
        'avatar_spawn': [0, -2.8, 0],
    },
    'PRESET_EXECUTIVE_FLOOR_V10_001': {
        'name': 'Executive Floor',
        'bounds': [-7, -4.5, 7, 4.5],
        'instances': [
            ['RECEPTION_BACKWALL_WOOD_SLAT_HERO_001', [-5.2, 2.8, 0], 0],
            ['RECEPTION_DESK_MARBLE_HERO_001', [-5.0, 1.6, 0], 0],
            ['DESK_L_CORNER_001', [-1.9, 1.9, 0], 0],
            ['CHAIR_EXECUTIVE_HIGHBACK_001', [-1.9, 0.8, 0], 0],
            ['ARCH_GLASS_MEETING_ROOM_HERO_001', [3.1, 2.0, 0], 0],
            ['MEETING_TABLE_8P_HERO_001', [3.1, 2.0, 0], 0],
            ['SOFA_SECTIONAL_BLUE_HERO_001', [-2.9, -2.2, 0], 0],
            ['TABLE_COFFEE_ROUND_001', [-1.4, -2.0, 0], 0],
            ['LOUNGE_CHAIR_ROUND_001', [-0.5, -2.7, 0], -35],
            ['PANTRY_COUNTER_MARBLE_HERO_001', [3.5, -2.6, 0], 180],
            ['PLANT_LARGE_REALISTIC_HERO_001', [-6.1, 3.5, 0], 0],
            ['PLANT_LARGE_REALISTIC_HERO_001', [6.0, 3.5, 0], 0],
            ['PLANT_MEDIUM_001', [5.8, -3.3, 0], 0],
        ],
        'avatar_spawn': [0, -3.3, 0],
    },
}
for preset_id, spec in layouts.items():
    instances = []
    for idx, (asset_id, pos, rot) in enumerate(spec['instances'], 1):
        if asset_id not in asset_index:
            continue
        instances.append({
            'instance_id': f'{preset_id}_{idx:03d}',
            'asset_id': asset_id,
            'position': pos,
            'rotation_z_deg': rot,
            'scale': [1, 1, 1],
        })
    payload = {
        'version': '10.0', 'preset_id': preset_id, 'name': spec['name'],
        'bounds_xy': spec['bounds'], 'avatar_spawn': spec['avatar_spawn'], 'instances': instances,
    }
    dump_json(OUT / '12_layout_presets' / f'{preset_id}.json', payload)

dump_json(OUT / '12_layout_presets' / 'layout-preset-registry-v10.json', {
    'version': '10.0',
    'presets': [
        {'preset_id': pid, 'file': f'12_layout_presets/{pid}.json', 'name': spec['name']}
        for pid, spec in layouts.items()
    ]
})

# Updated rigged scene manifest uses PBR scene and PBR characters.
scene_manifest_v9 = json.loads((OUT / '03_scene_prefabs' / 'SCENE_ACME_HQ_RIGGED_RUNTIME_V9_001.json').read_text(encoding='utf-8'))
scene_manifest_v10 = json.loads(json.dumps(scene_manifest_v9))
scene_manifest_v10['version'] = '10.0'
scene_manifest_v10['scene_id'] = 'SCENE_ACME_HQ_RIGGED_RUNTIME_V10_001'
scene_manifest_v10['environment_glb'] = scene_manifest_v10['environment_glb'].replace('01_runtime_3d/scenes/', '01_runtime_3d/scenes_pbr_v10/')
for char in scene_manifest_v10.get('characters', []):
    char['file'] = char['file'].replace('01_runtime_3d/models/', '01_runtime_3d/models_pbr_v10/')
scene_manifest_v10['layout_editor'] = '11_complete_runtime_app'
scene_manifest_v10['asset_registry'] = '05_registries/asset-registry-v10.json'
dump_json(OUT / '03_scene_prefabs' / 'SCENE_ACME_HQ_RIGGED_RUNTIME_V10_001.json', scene_manifest_v10)

# -----------------------------------------------------------------------------
# Complete Three.js runtime/editor application
# -----------------------------------------------------------------------------
APP = OUT / '11_complete_runtime_app'
if APP.exists(): shutil.rmtree(APP)
(APP / 'src' / 'runtime').mkdir(parents=True, exist_ok=True)
(APP / 'scripts').mkdir(parents=True, exist_ok=True)

write_text(APP / 'package.json', r'''
{
  "name": "virtual-office-complete-runtime-v10",
  "version": "10.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc --noEmit && vite build",
    "validate": "node scripts/validate-package.mjs"
  },
  "dependencies": {
    "three": "^0.180.0"
  },
  "devDependencies": {
    "@types/three": "^0.180.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.8.3",
    "vite": "^7.0.0",
    "@types/node": "^24.0.0"
  }
}
''')
write_text(APP / 'tsconfig.json', r'''
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"]
  },
  "include": ["src", "vite.config.ts"]
}
''')
write_text(APP / 'vite.config.ts', r'''
import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function servePackageFiles(): Plugin {
  return {
    name: 'serve-virtual-office-package-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const prefixes = ['/01_runtime_3d/', '/02_ui_overlay_assets/', '/03_scene_prefabs/', '/05_registries/', '/12_layout_presets/'];
        if (!prefixes.some((prefix) => url.startsWith(prefix))) return next();
        const file = path.resolve(packageRoot, `.${url}`);
        if (!file.startsWith(packageRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        const ext = path.extname(file).toLowerCase();
        const mime: Record<string, string> = {
          '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
          '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.csv': 'text/csv',
        };
        res.statusCode = 200;
        res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [servePackageFiles()],
  server: { fs: { allow: [packageRoot] } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
''')
write_text(APP / 'index.html', r'''
<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Virtual Office Complete Runtime v10</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
''')

write_text(APP / 'src' / 'types.ts', r'''
export type Vec3 = [number, number, number];

export interface AnchorData {
  position: Vec3;
  rotation?: Vec3;
}

export interface AssetRecord {
  asset_id: string;
  category: string;
  type?: string;
  priority?: string;
  file: string;
  legacy_file?: string;
  dimensions_m?: { width?: number; depth?: number; height?: number };
  collision?: { type?: string; center?: Vec3; size?: Vec3 };
  anchors?: Record<string, AnchorData>;
  interaction?: Record<string, unknown>;
  runtime_ready?: boolean;
  deliverable_kind?: string;
}

export interface AssetRegistry {
  version: string;
  asset_count: number;
  assets: AssetRecord[];
}

export interface LayoutInstance {
  instance_id: string;
  asset_id: string;
  position: Vec3;
  rotation_z_deg: number;
  scale?: Vec3;
}

export interface LayoutPreset {
  version: string;
  preset_id: string;
  name: string;
  bounds_xy: [number, number, number, number];
  avatar_spawn: Vec3;
  instances: LayoutInstance[];
}

export type ClipId =
  | 'ANIM_IDLE_001' | 'ANIM_WALK_001' | 'ANIM_SIT_001'
  | 'ANIM_SIT_DOWN_001' | 'ANIM_STAND_UP_001' | 'ANIM_TYPING_001'
  | 'ANIM_TALK_001' | 'ANIM_WAVE_001' | 'ANIM_MEETING_IDLE_001'
  | 'ANIM_POINT_001' | 'ANIM_PHONE_CALL_001' | 'ANIM_CLAP_001';
''')

write_text(APP / 'src' / 'runtime' / 'AssetStore.ts', r'''
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetRecord, AssetRegistry } from '../types.js';

export class AssetStore {
  readonly loader = new GLTFLoader();
  readonly records = new Map<string, AssetRecord>();
  private cache = new Map<string, THREE.Object3D>();

  async initialize(): Promise<void> {
    const response = await fetch('/05_registries/asset-registry-v10.json');
    if (!response.ok) throw new Error(`asset registry load failed: ${response.status}`);
    const registry = await response.json() as AssetRegistry;
    for (const asset of registry.assets) this.records.set(asset.asset_id, asset);
  }

  get(assetId: string): AssetRecord {
    const asset = this.records.get(assetId);
    if (!asset) throw new Error(`Unknown asset: ${assetId}`);
    return asset;
  }

  list(): AssetRecord[] {
    return [...this.records.values()].filter((asset) => asset.file.endsWith('.glb') && !asset.category.includes('animation'));
  }

  async instantiate(assetId: string): Promise<THREE.Object3D> {
    const record = this.get(assetId);
    let template = this.cache.get(record.file);
    if (!template) {
      const gltf = await this.loader.loadAsync(`/${record.file}`);
      template = gltf.scene;
      this.cache.set(record.file, template);
    }
    const hasSkin = template.getObjectByProperty('type', 'SkinnedMesh') !== undefined;
    const root = hasSkin ? cloneSkeleton(template) : template.clone(true);
    root.name = assetId;
    root.userData.assetId = assetId;
    root.userData.assetRecord = record;
    root.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        const std = material as THREE.MeshStandardMaterial;
        if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
        if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        std.needsUpdate = true;
      }
    });
    return root;
  }
}
''')

write_text(APP / 'src' / 'runtime' / 'GridNav.ts', r'''
import * as THREE from 'three';

export interface ObstacleRect { minX: number; minY: number; maxX: number; maxY: number; }
interface GridNode { x: number; y: number; f: number; g: number; h: number; parent?: GridNode; }

export class GridNav {
  constructor(
    public bounds: [number, number, number, number] = [-7, -5, 7, 5],
    public cellSize = 0.28,
    public avatarRadius = 0.28,
  ) {}

  obstacles: ObstacleRect[] = [];

  setObstacles(obstacles: ObstacleRect[]): void { this.obstacles = obstacles; }

  private worldToGrid(p: THREE.Vector3): [number, number] {
    return [Math.round((p.x - this.bounds[0]) / this.cellSize), Math.round((p.y - this.bounds[1]) / this.cellSize)];
  }
  private gridToWorld(x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(this.bounds[0] + x * this.cellSize, this.bounds[1] + y * this.cellSize, 0);
  }
  private blocked(x: number, y: number): boolean {
    const p = this.gridToWorld(x, y);
    if (p.x < this.bounds[0] || p.y < this.bounds[1] || p.x > this.bounds[2] || p.y > this.bounds[3]) return true;
    return this.obstacles.some((o) =>
      p.x >= o.minX - this.avatarRadius && p.x <= o.maxX + this.avatarRadius &&
      p.y >= o.minY - this.avatarRadius && p.y <= o.maxY + this.avatarRadius
    );
  }
  private key(x: number, y: number): string { return `${x},${y}`; }

  findPath(startWorld: THREE.Vector3, endWorld: THREE.Vector3): THREE.Vector3[] {
    const [sx, sy] = this.worldToGrid(startWorld);
    const [ex, ey] = this.worldToGrid(endWorld);
    if (this.blocked(ex, ey)) return [];
    const open = new Map<string, GridNode>();
    const closed = new Set<string>();
    const start: GridNode = { x: sx, y: sy, g: 0, h: 0, f: 0 };
    open.set(this.key(sx, sy), start);
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ] as const;
    let iterations = 0;
    while (open.size && iterations++ < 16000) {
      let current: GridNode | undefined;
      for (const node of open.values()) if (!current || node.f < current.f) current = node;
      if (!current) break;
      open.delete(this.key(current.x, current.y));
      if (current.x === ex && current.y === ey) {
        const path: THREE.Vector3[] = [];
        let node: GridNode | undefined = current;
        while (node) { path.push(this.gridToWorld(node.x, node.y)); node = node.parent; }
        path.reverse();
        return this.smooth(path);
      }
      closed.add(this.key(current.x, current.y));
      for (const [dx, dy, cost] of dirs) {
        const nx = current.x + dx, ny = current.y + dy;
        const key = this.key(nx, ny);
        if (closed.has(key) || this.blocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (this.blocked(current.x + dx, current.y) || this.blocked(current.x, current.y + dy))) continue;
        const g = current.g + cost;
        const h = Math.hypot(ex - nx, ey - ny);
        const existing = open.get(key);
        if (!existing || g < existing.g) open.set(key, { x: nx, y: ny, g, h, f: g + h, parent: current });
      }
    }
    return [];
  }

  private clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = a.distanceTo(b);
    const steps = Math.max(2, Math.ceil(dist / (this.cellSize * 0.55)));
    for (let i = 1; i < steps; i++) {
      const p = a.clone().lerp(b, i / steps);
      const [gx, gy] = this.worldToGrid(p);
      if (this.blocked(gx, gy)) return false;
    }
    return true;
  }

  private smooth(path: THREE.Vector3[]): THREE.Vector3[] {
    if (path.length <= 2) return path;
    const result = [path[0]!];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let furthest = anchor + 1;
      for (let candidate = path.length - 1; candidate > anchor + 1; candidate--) {
        if (this.clearLine(path[anchor]!, path[candidate]!)) { furthest = candidate; break; }
      }
      result.push(path[furthest]!);
      anchor = furthest;
    }
    return result;
  }
}
''')

write_text(APP / 'src' / 'runtime' / 'AvatarController.ts', r'''
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ClipId } from '../types.js';
import { GridNav } from './GridNav.js';

export class AvatarController {
  root = new THREE.Group();
  mixer?: THREE.AnimationMixer;
  actions = new Map<ClipId, THREE.AnimationAction>();
  active?: THREE.AnimationAction;
  path: THREE.Vector3[] = [];
  speed = 1.35;
  moving = false;
  seated = false;
  private loader = new GLTFLoader();

  constructor(public nav: GridNav) { this.root.name = 'PlayerAvatar'; }

  async load(file = '/01_runtime_3d/models_pbr_v10/characters_rigged/CHAR_FEMALE_RIGGED_HERO_V8_001.glb'): Promise<void> {
    const gltf = await this.loader.loadAsync(file);
    const model = cloneSkeleton(gltf.scene);
    this.root.clear();
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      this.actions.set(clip.name as ClipId, this.mixer.clipAction(clip));
    }
    this.play('ANIM_IDLE_001');
    model.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
  }

  play(id: ClipId, fade = 0.16): void {
    const next = this.actions.get(id);
    if (!next || next === this.active) return;
    next.reset();
    if (id === 'ANIM_SIT_DOWN_001' || id === 'ANIM_STAND_UP_001' || id === 'ANIM_WAVE_001' || id === 'ANIM_POINT_001' || id === 'ANIM_CLAP_001') {
      next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    if (this.active) this.active.fadeOut(fade);
    next.fadeIn(fade).play();
    this.active = next;
  }

  moveTo(target: THREE.Vector3): boolean {
    if (this.seated) return false;
    const path = this.nav.findPath(this.root.position, target);
    if (!path.length) return false;
    this.path = path.slice(1);
    this.moving = this.path.length > 0;
    if (this.moving) this.play('ANIM_WALK_001');
    return this.moving;
  }

  stop(): void {
    this.path = []; this.moving = false;
    if (!this.seated) this.play('ANIM_IDLE_001');
  }

  sitAt(position: THREE.Vector3, yawRadians: number, typing = false): void {
    this.stop();
    this.root.position.copy(position);
    this.root.rotation.z = yawRadians;
    this.seated = true;
    this.play(typing ? 'ANIM_TYPING_001' : 'ANIM_SIT_001');
  }

  stand(): void {
    this.seated = false;
    this.play('ANIM_STAND_UP_001');
    window.setTimeout(() => this.play('ANIM_IDLE_001'), 850);
  }

  update(dt: number): void {
    this.mixer?.update(dt);
    if (!this.moving || !this.path.length) return;
    const target = this.path[0]!;
    const delta = target.clone().sub(this.root.position);
    delta.z = 0;
    const distance = delta.length();
    if (distance < 0.06) {
      this.path.shift();
      if (!this.path.length) this.stop();
      return;
    }
    const dir = delta.normalize();
    const desired = Math.atan2(dir.y, dir.x) - Math.PI / 2;
    let diff = desired - this.root.rotation.z;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.root.rotation.z += diff * Math.min(1, dt * 9);
    this.root.position.addScaledVector(dir, Math.min(distance, this.speed * dt));
  }
}
''')

write_text(APP / 'src' / 'runtime' / 'LayoutEditor.ts', r'''
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssetRecord, LayoutInstance, LayoutPreset, Vec3 } from '../types.js';
import { AssetStore } from './AssetStore.js';
import type { ObstacleRect } from './GridNav.js';

interface RuntimeInstance { spec: LayoutInstance; root: THREE.Object3D; record: AssetRecord; }

export class LayoutEditor extends EventTarget {
  instances = new Map<string, RuntimeInstance>();
  selected?: RuntimeInstance;
  transform: TransformControls;
  helper = new THREE.BoxHelper(new THREE.Group(), 0x3d7bff);
  gridSize = 0.25;
  mode: 'translate' | 'rotate' = 'translate';

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private renderer: THREE.WebGLRenderer,
    private orbit: OrbitControls,
    private store: AssetStore,
  ) {
    super();
    this.transform = new TransformControls(camera, renderer.domElement);
    this.transform.setSpace('world');
    this.transform.setTranslationSnap(this.gridSize);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(15));
    this.transform.addEventListener('dragging-changed', (event) => { this.orbit.enabled = !event.value; });
    this.transform.addEventListener('objectChange', () => {
      if (!this.selected) return;
      const p = this.selected.root.position;
      p.z = 0;
      this.selected.spec.position = [p.x, p.y, p.z];
      this.selected.spec.rotation_z_deg = THREE.MathUtils.radToDeg(this.selected.root.rotation.z);
      this.helper.update();
      this.dispatchEvent(new Event('layoutchange'));
    });
    scene.add(this.transform.getHelper());
    scene.add(this.helper);
    this.helper.visible = false;
  }

  async spawn(assetId: string, position: Vec3 = [0, 0, 0], rotationZDeg = 0, id?: string): Promise<RuntimeInstance> {
    const record = this.store.get(assetId);
    const root = await this.store.instantiate(assetId);
    root.position.fromArray(position);
    root.rotation.z = THREE.MathUtils.degToRad(rotationZDeg);
    const instanceId = id ?? `${assetId}_${crypto.randomUUID().slice(0, 8)}`;
    root.userData.instanceId = instanceId;
    this.scene.add(root);
    const spec: LayoutInstance = { instance_id: instanceId, asset_id: assetId, position: [...position] as Vec3, rotation_z_deg: rotationZDeg, scale: [1, 1, 1] };
    const runtime = { spec, root, record };
    this.instances.set(instanceId, runtime);
    this.dispatchEvent(new Event('layoutchange'));
    return runtime;
  }

  async loadPreset(preset: LayoutPreset): Promise<void> {
    this.clear();
    for (const item of preset.instances) await this.spawn(item.asset_id, item.position, item.rotation_z_deg, item.instance_id);
    this.dispatchEvent(new Event('layoutchange'));
  }

  clear(): void {
    for (const item of this.instances.values()) this.scene.remove(item.root);
    this.instances.clear();
    this.select(undefined);
  }

  select(item?: RuntimeInstance): void {
    this.selected = item;
    if (!item) {
      this.transform.detach(); this.helper.visible = false;
    } else {
      this.transform.attach(item.root);
      this.transform.setMode(this.mode);
      this.helper.setFromObject(item.root); this.helper.visible = true;
    }
    this.dispatchEvent(new CustomEvent('selectionchange', { detail: item }));
  }

  pick(raycaster: THREE.Raycaster): RuntimeInstance | undefined {
    const roots = [...this.instances.values()].map((i) => i.root);
    const hit = raycaster.intersectObjects(roots, true)[0];
    if (!hit) return undefined;
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.instanceId) object = object.parent;
    return object ? this.instances.get(object.userData.instanceId as string) : undefined;
  }

  setMode(mode: 'translate' | 'rotate'): void { this.mode = mode; this.transform.setMode(mode); }

  async duplicateSelected(): Promise<void> {
    if (!this.selected) return;
    const p = this.selected.root.position.clone().add(new THREE.Vector3(0.5, 0.5, 0));
    const copy = await this.spawn(this.selected.spec.asset_id, [p.x, p.y, 0], this.selected.spec.rotation_z_deg);
    this.select(copy);
  }

  deleteSelected(): void {
    if (!this.selected) return;
    this.scene.remove(this.selected.root);
    this.instances.delete(this.selected.spec.instance_id);
    this.select(undefined);
    this.dispatchEvent(new Event('layoutchange'));
  }

  exportLayout(name = 'Custom Office'): LayoutPreset {
    return {
      version: '10.0', preset_id: `CUSTOM_${Date.now()}`, name,
      bounds_xy: [-7, -5, 7, 5], avatar_spawn: [0, -3.5, 0],
      instances: [...this.instances.values()].map((i) => ({ ...i.spec, position: [...i.spec.position] as Vec3, scale: [...(i.spec.scale ?? [1, 1, 1])] as Vec3 })),
    };
  }

  getObstacles(): ObstacleRect[] {
    const obstacles: ObstacleRect[] = [];
    for (const item of this.instances.values()) {
      const collision = item.record.collision;
      if (!collision?.size) continue;
      const [w, d] = collision.size;
      // Do not block very thin floor/rug assets and explicitly walkable categories.
      if ((item.record.type ?? '').includes('floor') || item.record.category === 'decor' && (item.record.type ?? '').includes('rug')) continue;
      const yaw = item.root.rotation.z;
      const cw = Math.abs(Math.cos(yaw)), sw = Math.abs(Math.sin(yaw));
      const extX = (w * cw + d * sw) / 2;
      const extY = (w * sw + d * cw) / 2;
      obstacles.push({ minX: item.root.position.x - extX, maxX: item.root.position.x + extX, minY: item.root.position.y - extY, maxY: item.root.position.y + extY });
    }
    return obstacles;
  }

  nearestInteraction(position: THREE.Vector3, maxDistance = 1.35): { position: THREE.Vector3; yaw: number; typing: boolean; label: string } | undefined {
    let best: { position: THREE.Vector3; yaw: number; typing: boolean; label: string; distance: number } | undefined;
    for (const item of this.instances.values()) {
      const anchors = item.record.anchors ?? {};
      for (const [name, anchor] of Object.entries(anchors)) {
        if (!/(seat|work|meeting)/i.test(name)) continue;
        const local = new THREE.Vector3(...anchor.position);
        local.applyAxisAngle(new THREE.Vector3(0, 0, 1), item.root.rotation.z).add(item.root.position);
        const distance = local.distanceTo(position);
        if (distance > maxDistance || (best && distance >= best.distance)) continue;
        const rz = anchor.rotation?.[2] ?? 0;
        best = { position: local, yaw: item.root.rotation.z + THREE.MathUtils.degToRad(rz), typing: /work/i.test(name), label: `${item.record.asset_id} · ${name}`, distance };
      }
    }
    return best;
  }
}
''')

write_text(APP / 'src' / 'runtime' / 'OfficeApp.ts', r'''
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AssetStore } from './AssetStore.js';
import { GridNav } from './GridNav.js';
import { AvatarController } from './AvatarController.js';
import { LayoutEditor } from './LayoutEditor.js';
import type { AssetRecord, LayoutPreset } from '../types.js';

export class OfficeApp {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labels = new CSS2DRenderer();
  controls: OrbitControls;
  composer: EffectComposer;
  store = new AssetStore();
  nav = new GridNav();
  avatar = new AvatarController(this.nav);
  editor!: LayoutEditor;
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ color: 0x8b8985, roughness: 0.78 }));
  clock = new THREE.Clock();
  nameTag = document.createElement('div');
  status = '준비 중';
  onStatus?: (text: string) => void;

  constructor(public container: HTMLElement) {
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.scene.background = new THREE.Color(0x111821);
    this.scene.fog = new THREE.FogExp2(0x111821, 0.016);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 90);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(10.8, -12.4, 10.2);
    this.camera.lookAt(0, 0, 0.8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.labels.domElement.className = 'label-layer';
    container.append(this.labels.domElement);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.target.set(0, 0, 0.8);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 28;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.58, 0.78);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.setupEnvironment();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const hemi = new THREE.HemisphereLight(0xbdd8ff, 0x3a2d22, 1.2);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 4.2);
    sun.position.set(-5, -6, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7ba9ff, 1.1);
    fill.position.set(8, 4, 7); this.scene.add(fill);
    this.ground.rotation.x = 0;
    this.ground.position.z = -0.02;
    this.ground.receiveShadow = true;
    this.ground.name = 'RuntimeGround';
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(14, 56, 0x49617a, 0x2c3744);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    this.scene.add(grid);
  }

  async initialize(): Promise<void> {
    this.setStatus('레지스트리 로딩');
    await this.store.initialize();
    this.editor = new LayoutEditor(this.scene, this.camera, this.renderer, this.controls, this.store);
    this.editor.addEventListener('layoutchange', () => this.nav.setObstacles(this.editor.getObstacles()));
    this.scene.add(this.avatar.root);
    this.setStatus('캐릭터 로딩');
    await this.avatar.load();
    this.avatar.root.position.set(0, -3.2, 0);
    this.addNameTag();
    this.bindPointer();
    this.animate();
    this.setStatus('준비 완료');
  }

  async loadPreset(url: string): Promise<LayoutPreset> {
    this.setStatus('프리셋 로딩');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Preset failed: ${response.status}`);
    const preset = await response.json() as LayoutPreset;
    await this.editor.loadPreset(preset);
    this.nav.bounds = preset.bounds_xy;
    this.nav.setObstacles(this.editor.getObstacles());
    this.avatar.root.position.fromArray(preset.avatar_spawn);
    this.avatar.stop();
    this.setStatus(`${preset.name} 로드 완료`);
    return preset;
  }

  private addNameTag(): void {
    this.nameTag.className = 'name-tag';
    this.nameTag.innerHTML = '<span class="status-dot"></span>내 아바타';
    const label = new CSS2DObject(this.nameTag);
    label.position.set(0, 0, 2.0);
    this.avatar.root.add(label);
  }

  private bindPointer(): void {
    this.labels.domElement.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = this.labels.domElement.getBoundingClientRect();
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const selected = this.editor.pick(this.raycaster);
      if (selected) { this.editor.select(selected); return; }
      const groundHit = this.raycaster.intersectObject(this.ground, false)[0];
      if (groundHit) {
        this.editor.select(undefined);
        const ok = this.avatar.moveTo(groundHit.point);
        this.setStatus(ok ? '이동 중' : '목적지에 접근할 수 없습니다');
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Delete' || event.key === 'Backspace') this.editor.deleteSelected();
      if (event.key.toLowerCase() === 'g') this.editor.setMode('translate');
      if (event.key.toLowerCase() === 'r') this.editor.setMode('rotate');
      if (event.key.toLowerCase() === 'd' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void this.editor.duplicateSelected(); }
      if (event.key.toLowerCase() === 'e') this.interact();
      if (event.key === 'Escape') { if (this.avatar.seated) this.avatar.stand(); else this.editor.select(undefined); }
    });
  }

  interact(): void {
    if (this.avatar.seated) { this.avatar.stand(); this.setStatus('일어섰습니다'); return; }
    const interaction = this.editor.nearestInteraction(this.avatar.root.position);
    if (!interaction) { this.setStatus('가까운 좌석/업무 지점이 없습니다'); return; }
    this.avatar.sitAt(interaction.position, interaction.yaw, interaction.typing);
    this.setStatus(interaction.typing ? '업무 중' : '착석');
  }

  async addAsset(assetId: string): Promise<void> {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const p = this.controls.target.clone().add(forward.multiplyScalar(0.1));
    p.z = 0;
    const item = await this.editor.spawn(assetId, [p.x, p.y, 0]);
    this.editor.select(item);
    this.setStatus(`${assetId} 추가`);
  }

  availableAssets(): AssetRecord[] { return this.store.list(); }

  exportLayout(): void {
    const data = this.editor.exportLayout();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'virtual-office-layout-v10.json'; a.click();
    URL.revokeObjectURL(url);
  }

  saveLocal(): void {
    localStorage.setItem('virtual-office-layout-v10', JSON.stringify(this.editor.exportLayout()));
    this.setStatus('브라우저에 저장했습니다');
  }

  async loadLocal(): Promise<void> {
    const raw = localStorage.getItem('virtual-office-layout-v10');
    if (!raw) { this.setStatus('저장된 레이아웃이 없습니다'); return; }
    await this.editor.loadPreset(JSON.parse(raw) as LayoutPreset);
    this.nav.setObstacles(this.editor.getObstacles());
    this.setStatus('저장된 레이아웃을 불러왔습니다');
  }

  setStatus(text: string): void { this.status = text; this.onStatus?.(text); }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.labels.setSize(w, h); this.composer.setSize(w, h);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.avatar.update(dt);
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  };
}
''')

write_text(APP / 'src' / 'main.ts', r'''
import './styles.css';
import { OfficeApp } from './runtime/OfficeApp.js';
import type { AssetRecord } from './types.js';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');
root.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">◉</span><div><strong>Virtual Office</strong><small>Complete Product v10</small></div></div>
      <div class="top-actions">
        <button id="moveMode">이동 G</button><button id="rotateMode">회전 R</button>
        <button id="save">저장</button><button id="load">불러오기</button><button id="export">JSON 내보내기</button>
      </div>
    </header>
    <aside class="catalog panel">
      <div class="panel-title"><span>에셋 카탈로그</span><input id="search" placeholder="검색" /></div>
      <div id="categories" class="categories"></div>
      <div id="assetList" class="asset-list"></div>
    </aside>
    <main id="viewport" class="viewport"><div id="loading" class="loading">패키지 로딩 중…</div></main>
    <aside class="inspector panel">
      <div class="panel-title">인스펙터</div>
      <div id="selection" class="selection-empty">에셋을 선택하세요.</div>
      <div class="separator"></div>
      <label>레이아웃 프리셋</label>
      <select id="preset">
        <option value="/12_layout_presets/PRESET_OPEN_OFFICE_V10_001.json">Open Office HQ</option>
        <option value="/12_layout_presets/PRESET_COMPACT_STARTUP_V10_001.json">Compact Startup</option>
        <option value="/12_layout_presets/PRESET_EXECUTIVE_FLOOR_V10_001.json">Executive Floor</option>
      </select>
      <button id="loadPreset" class="primary">프리셋 적용</button>
      <div class="separator"></div>
      <button id="interact" class="primary">좌석/업무 상호작용 E</button>
      <button id="stand">일어나기 Esc</button>
      <div class="help">
        바닥 클릭: 캐릭터 이동<br />에셋 클릭: 선택<br />G/R: 이동·회전<br />Ctrl/Cmd+D: 복제<br />Delete: 삭제
      </div>
    </aside>
    <footer class="statusbar"><span class="online-dot"></span><span id="status">초기화 중</span><span class="spacer"></span><span>PBR GLB · Rigged · 12 Clips · Layout Editor · A* Navigation</span></footer>
  </div>`;

const viewport = document.querySelector<HTMLElement>('#viewport')!;
const app = new OfficeApp(viewport);
const loading = document.querySelector<HTMLElement>('#loading')!;
const status = document.querySelector<HTMLElement>('#status')!;
app.onStatus = (text) => { status.textContent = text; };

let allAssets: AssetRecord[] = [];
let activeCategory = 'all';

function renderCatalog(): void {
  const query = (document.querySelector<HTMLInputElement>('#search')!.value ?? '').trim().toLowerCase();
  const filtered = allAssets.filter((a) =>
    (activeCategory === 'all' || a.category === activeCategory) &&
    (!query || `${a.asset_id} ${a.category} ${a.type ?? ''}`.toLowerCase().includes(query))
  ).slice(0, 120);
  document.querySelector('#assetList')!.innerHTML = filtered.map((a) => `
    <button class="asset-card" data-id="${a.asset_id}">
      <span class="asset-icon">${iconFor(a.category)}</span>
      <span><strong>${pretty(a.asset_id)}</strong><small>${a.category} · ${a.type ?? 'asset'}</small></span>
    </button>`).join('');
  document.querySelectorAll<HTMLButtonElement>('.asset-card').forEach((button) => {
    button.onclick = () => void app.addAsset(button.dataset.id!);
  });
}

function iconFor(category: string): string {
  return ({ architecture: '▦', workstation: '▰', meeting: '◫', reception: '◒', lounge: '◉', focus: '▣', pantry: '◆', props: '◇', storage: '▤', plants: '♣', decor: '▧', lighting: '✦', character: '●', characters: '●' } as Record<string, string>)[category] ?? '□';
}
function pretty(id: string): string { return id.replace(/_00\d$/, '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }

async function start(): Promise<void> {
  await app.initialize();
  allAssets = app.availableAssets().filter((a) => !a.asset_id.includes('RIGGED') && a.category !== 'scene');
  const cats = ['all', ...new Set(allAssets.map((a) => a.category))];
  document.querySelector('#categories')!.innerHTML = cats.map((c) => `<button data-category="${c}" class="category ${c === 'all' ? 'active' : ''}">${c}</button>`).join('');
  document.querySelectorAll<HTMLButtonElement>('.category').forEach((button) => button.onclick = () => {
    activeCategory = button.dataset.category!;
    document.querySelectorAll('.category').forEach((b) => b.classList.remove('active'));
    button.classList.add('active'); renderCatalog();
  });
  renderCatalog();
  await app.loadPreset('/12_layout_presets/PRESET_OPEN_OFFICE_V10_001.json');
  loading.remove();
  app.editor.addEventListener('selectionchange', (event) => {
    const item = (event as CustomEvent).detail as { spec: { asset_id: string; instance_id: string }, record: AssetRecord } | undefined;
    const node = document.querySelector<HTMLElement>('#selection')!;
    node.innerHTML = item ? `<strong>${pretty(item.spec.asset_id)}</strong><small>${item.spec.instance_id}</small><small>${item.record.category} · ${item.record.type ?? ''}</small><button id="duplicate">복제</button><button id="delete" class="danger">삭제</button>` : '에셋을 선택하세요.';
    document.querySelector<HTMLButtonElement>('#duplicate')?.addEventListener('click', () => void app.editor.duplicateSelected());
    document.querySelector<HTMLButtonElement>('#delete')?.addEventListener('click', () => app.editor.deleteSelected());
  });
}

document.querySelector<HTMLInputElement>('#search')!.oninput = renderCatalog;
document.querySelector<HTMLButtonElement>('#moveMode')!.onclick = () => app.editor.setMode('translate');
document.querySelector<HTMLButtonElement>('#rotateMode')!.onclick = () => app.editor.setMode('rotate');
document.querySelector<HTMLButtonElement>('#save')!.onclick = () => app.saveLocal();
document.querySelector<HTMLButtonElement>('#load')!.onclick = () => void app.loadLocal();
document.querySelector<HTMLButtonElement>('#export')!.onclick = () => app.exportLayout();
document.querySelector<HTMLButtonElement>('#interact')!.onclick = () => app.interact();
document.querySelector<HTMLButtonElement>('#stand')!.onclick = () => app.avatar.stand();
document.querySelector<HTMLButtonElement>('#loadPreset')!.onclick = () => void app.loadPreset(document.querySelector<HTMLSelectElement>('#preset')!.value);

void start().catch((error) => {
  console.error(error);
  loading.textContent = `초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
  status.textContent = '오류';
});
''')

write_text(APP / 'src' / 'styles.css', r'''
:root { font-family: Inter, Pretendard, system-ui, sans-serif; color: #ecf2fa; background: #07101b; font-synthesis: none; }
* { box-sizing: border-box; }
html, body, #app { margin: 0; width: 100%; height: 100%; overflow: hidden; }
button, input, select { font: inherit; }
button { color: #dbe8f7; background: #111d2c; border: 1px solid #24354a; border-radius: 8px; padding: 8px 11px; cursor: pointer; }
button:hover { border-color: #3d7bff; background: #172842; }
.shell { display: grid; width: 100%; height: 100%; grid-template-columns: 260px 1fr 270px; grid-template-rows: 64px 1fr 34px; grid-template-areas: 'top top top' 'catalog view inspector' 'status status status'; background: #080f19; }
.topbar { grid-area: top; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid #1e2b3b; background: linear-gradient(180deg,#0e1724,#09111c); }
.brand { display: flex; gap: 12px; align-items: center; }.brand-mark { display: grid; place-items: center; width: 38px; height: 38px; background: #17263a; border: 1px solid #34475d; border-radius: 10px; color: #6ea0ff; font-size: 24px; }
.brand strong { display:block; font-size: 17px; }.brand small { display:block; color:#7f92aa; margin-top:2px; }.top-actions { display:flex; gap:8px; }
.panel { background: #0a1421; border-color: #1d2a3a; overflow: hidden; }
.catalog { grid-area: catalog; border-right: 1px solid #1d2a3a; display:flex; flex-direction:column; }.inspector { grid-area: inspector; border-left:1px solid #1d2a3a; padding:14px; overflow-y:auto; }
.panel-title { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:48px; padding:10px 12px; border-bottom:1px solid #1d2a3a; font-weight:700; }.panel-title input { width:110px; border:1px solid #26374c; background:#07101b; color:#dce8f5; border-radius:7px; padding:7px 8px; }
.categories { display:flex; gap:6px; padding:10px; overflow-x:auto; border-bottom:1px solid #1c2938; }.category { padding:6px 9px; white-space:nowrap; font-size:11px; text-transform:capitalize; }.category.active { background:#245ccf; border-color:#4b85ff; }
.asset-list { overflow-y:auto; padding:8px; }.asset-card { width:100%; display:flex; text-align:left; align-items:center; gap:10px; margin-bottom:6px; padding:9px; }.asset-card strong,.asset-card small { display:block; }.asset-card strong { font-size:12px; line-height:1.25; }.asset-card small { margin-top:3px; color:#71859d; font-size:10px; }.asset-icon { display:grid; place-items:center; width:34px; height:34px; flex:none; border-radius:8px; background:#17263a; color:#72a0ff; font-size:18px; }
.viewport { grid-area:view; position:relative; min-width:0; min-height:0; }.viewport canvas,.label-layer { position:absolute; inset:0; width:100%; height:100%; }.label-layer { pointer-events:auto; overflow:hidden; }.loading { position:absolute; z-index:20; left:50%; top:50%; transform:translate(-50%,-50%); padding:14px 18px; border-radius:10px; background:#08111ddf; border:1px solid #2c4058; box-shadow:0 12px 40px #0008; }
.name-tag { padding:6px 10px; border-radius:14px; background:#101924e8; border:1px solid #33445a; font-size:12px; white-space:nowrap; box-shadow:0 4px 16px #0008; }.status-dot,.online-dot { display:inline-block; width:8px; height:8px; background:#58d878; border-radius:50%; margin-right:6px; box-shadow:0 0 8px #58d87888; }
.inspector label { display:block; color:#8094ac; font-size:11px; margin:8px 0 6px; }.inspector select { width:100%; padding:9px; color:#e7eef7; background:#08111d; border:1px solid #26384d; border-radius:8px; }.inspector button { width:100%; margin-top:8px; }.primary { background:#245ccf; border-color:#4b82f5; }.danger { color:#ffb4b4; border-color:#6b3237; }.separator { height:1px; background:#1e2b3b; margin:14px 0; }.selection-empty { color:#72859b; padding:10px 0; }.selection-empty strong,.selection-empty small { display:block; }.selection-empty small { margin-top:4px; color:#758aa3; }.help { margin-top:18px; color:#71849b; font-size:11px; line-height:1.8; }
.statusbar { grid-area:status; display:flex; align-items:center; padding:0 14px; gap:6px; color:#8fa2ba; background:#07101a; border-top:1px solid #1d2a3a; font-size:11px; }.spacer { flex:1; }
@media (max-width: 1050px) { .shell { grid-template-columns: 210px 1fr; grid-template-areas:'top top' 'catalog view' 'status status'; }.inspector { display:none; } }
''')

write_text(APP / 'scripts' / 'validate-package.mjs', r'''
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd(), '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, '05_registries/asset-registry-v10.json'), 'utf8'));
const missing = [];
for (const asset of registry.assets) {
  if (!asset.file) continue;
  const file = path.join(root, asset.file);
  if (!fs.existsSync(file)) missing.push(asset.file);
}
for (const preset of fs.readdirSync(path.join(root, '12_layout_presets')).filter((f) => f.startsWith('PRESET_') && f.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(root, '12_layout_presets', preset), 'utf8'));
  for (const item of data.instances) if (!registry.assets.some((a) => a.asset_id === item.asset_id)) missing.push(`${preset}: ${item.asset_id}`);
}
if (missing.length) { console.error('Missing:', missing); process.exit(1); }
console.log(JSON.stringify({ status: 'PASS', assets: registry.assets.length, pbr: registry.assets.filter((a) => a.pbr_v10?.embedded).length }, null, 2));
''')

write_text(APP / 'README_KO.md', r'''
# Virtual Office Complete Runtime v10

이 폴더는 전체 에셋을 실제로 배치하고 캐릭터를 이동시키는 Three.js 실행 앱입니다.

## 실행

패키지 루트에서 가장 간단한 방법:

```bash
python run_virtual_office_v10.py
```

브라우저에서 `http://localhost:8765`을 엽니다.

소스 개발:

```bash
cd 11_complete_runtime_app
npm install
npm run dev
```

## 포함 기능

- 개별 GLB 에셋 카탈로그 및 즉시 배치
- 이동/회전/복제/삭제
- 0.25m 그리드 스냅 및 15도 회전 스냅
- 레이아웃 브라우저 저장/불러오기 및 JSON 내보내기
- 남녀 리깅 캐릭터와 12개 애니메이션 클립
- 바닥 클릭 이동, A* 경로 탐색, 가구 충돌 회피
- 좌석/업무 앵커 접근 후 앉기·타이핑
- PBR 텍스처 내장 GLB 우선 로드
- ACES 톤매핑, 소프트 섀도, 환경광, 블룸

멀티플레이 서버, 로그인, 채팅, WebRTC 영상회의는 에셋 제품의 범위를 넘어서는 애플리케이션 백엔드 기능이므로 포함하지 않습니다.
''')

# Static server that serves the package root and redirects to built runtime.
write_text(OUT / 'run_virtual_office_v10.py', r'''
from __future__ import annotations
import http.server
import os
import socketserver
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('PORT', '8765'))

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        original = os.getcwd()
        try:
            os.chdir(ROOT)
            return super().translate_path(path)
        finally:
            os.chdir(original)

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', '/11_complete_runtime_app/dist/index.html')
            self.end_headers()
            return
        return super().do_GET()

with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), Handler) as server:
    print(f'Virtual Office v10: http://localhost:{PORT}')
    try: webbrowser.open(f'http://localhost:{PORT}')
    except Exception: pass
    server.serve_forever()
''')

# Unity additions.
UNITY = OUT / '04_engine_integration' / 'unity_v10'
(UNITY / 'Runtime').mkdir(parents=True, exist_ok=True)
write_text(UNITY / 'Runtime' / 'VirtualOfficeNavAgentV10.cs', r'''
using UnityEngine;
using UnityEngine.AI;

namespace VirtualOffice.V10 {
    [RequireComponent(typeof(NavMeshAgent), typeof(Animator))]
    public sealed class VirtualOfficeNavAgentV10 : MonoBehaviour {
        [SerializeField] private Camera inputCamera;
        private NavMeshAgent agent;
        private Animator animator;
        private static readonly int Speed = Animator.StringToHash("Speed");
        private void Awake() { agent = GetComponent<NavMeshAgent>(); animator = GetComponent<Animator>(); if (!inputCamera) inputCamera = Camera.main; }
        private void Update() {
            if (Input.GetMouseButtonDown(0) && Physics.Raycast(inputCamera.ScreenPointToRay(Input.mousePosition), out var hit, 500f)) agent.SetDestination(hit.point);
            animator.SetFloat(Speed, agent.velocity.magnitude, 0.12f, Time.deltaTime);
        }
    }
}
''')
write_text(UNITY / 'Runtime' / 'VirtualOfficeLayoutSpawnerV10.cs', r'''
using System;
using System.Collections.Generic;
using UnityEngine;

namespace VirtualOffice.V10 {
    [Serializable] public class LayoutItem { public string asset_id; public string instance_id; public float[] position; public float rotation_z_deg; }
    [Serializable] public class LayoutPreset { public string preset_id; public LayoutItem[] instances; }
    public sealed class VirtualOfficeLayoutSpawnerV10 : MonoBehaviour {
        [Serializable] public class AssetPrefab { public string assetId; public GameObject prefab; }
        public AssetPrefab[] catalog;
        public void Spawn(TextAsset layoutJson) {
            var preset = JsonUtility.FromJson<LayoutPreset>(layoutJson.text);
            var map = new Dictionary<string, GameObject>(); foreach (var item in catalog) map[item.assetId] = item.prefab;
            foreach (var item in preset.instances) if (map.TryGetValue(item.asset_id, out var prefab)) {
                var p = item.position; Instantiate(prefab, new Vector3(p[0], p[2], p[1]), Quaternion.Euler(0, -item.rotation_z_deg, 0), transform).name = item.instance_id;
            }
        }
    }
}
''')
write_text(UNITY / 'README_KO.md', r'''
# Unity v10 연동

`models_pbr_v10` GLB를 UnityGLTF 또는 glTFast로 임포트하고 `VirtualOfficeNavAgentV10`을 리깅 캐릭터에 추가합니다. 씬에 NavMesh를 베이크하면 클릭 이동과 Idle/Walk 블렌드 연결이 가능합니다. `VirtualOfficeLayoutSpawnerV10`은 JSON 레이아웃 배치용 기본 스포너입니다.
''')

# Godot additions.
GODOT = OUT / '04_engine_integration' / 'godot_v10'
GODOT.mkdir(parents=True, exist_ok=True)
write_text(GODOT / 'virtual_office_nav_agent_v10.gd', r'''
extends CharacterBody3D
@export var speed := 1.35
@onready var nav: NavigationAgent3D = $NavigationAgent3D
@onready var animation: AnimationPlayer = $AnimationPlayer

func move_to(point: Vector3) -> void:
    nav.target_position = point

func _physics_process(_delta: float) -> void:
    if nav.is_navigation_finished():
        velocity = Vector3.ZERO
        if animation.has_animation("ANIM_IDLE_001"): animation.play("ANIM_IDLE_001")
        return
    var next := nav.get_next_path_position()
    var direction := (next - global_position).normalized()
    velocity = direction * speed
    look_at(global_position + direction, Vector3.UP)
    if animation.has_animation("ANIM_WALK_001"): animation.play("ANIM_WALK_001")
    move_and_slide()
''')

# -----------------------------------------------------------------------------
# Documentation, validation, build
# -----------------------------------------------------------------------------
write_text(OUT / '00_start_here' / 'README_START_HERE_V10_KO.md', r'''
# Virtual Office Complete Product v10.0

이 패키지는 v9의 전체 오피스 에셋에 다음을 실제 파일로 추가한 통합 개발 제품입니다.

- 모든 모델/씬의 PBR 강화본: UV0, 노멀, BaseColor, Normal, Metallic-Roughness가 GLB 내부에 포함
- 리깅·스킨 캐릭터 8종과 캐릭터별 내장 애니메이션 12종
- 개별 에셋 자유 배치용 레지스트리 및 3개 레이아웃 프리셋
- 캐릭터 바닥 클릭 이동, A* 경로 탐색, 충돌 회피
- 좌석/업무 앵커 기반 앉기·타이핑
- 이동·회전·복제·삭제·저장·불러오기 가능한 Three.js 레이아웃 편집기
- Three.js, Unity, Godot 연동 코드

## 가장 빠른 실행

```bash
python run_virtual_office_v10.py
```

그다음 `http://localhost:8765`을 엽니다.

## 개발에서 우선 사용할 경로

```text
01_runtime_3d/models_pbr_v10/       개별 PBR 내장 모델
01_runtime_3d/scenes_pbr_v10/       PBR 내장 완성 씬
05_registries/asset-registry-v10.json
12_layout_presets/
11_complete_runtime_app/
```

## 중요한 품질 범위

이번 v10은 실제 로딩·배치·리깅·애니메이션·PBR·이동·편집 기능을 갖춘 완성형 실시간 개발 패키지입니다. 다만 모델 형상은 실시간 최적화된 스타일라이즈드/절차형 기반이며, 첨부한 콘셉트 이미지와 동일한 수작업 포토리얼 조형 품질을 의미하지는 않습니다. 콘셉트와 동일한 근접 촬영용 품질에는 전문 3D 아티스트의 수작업 리토폴로지, 디테일 스컬프팅, 아트 디렉션 검수가 추가로 필요합니다.
''')

write_text(OUT / '08_delivery_notes' / 'COMPLETE_PRODUCT_SCOPE_V10_KO.md', r'''
# v10 완제품 범위

## 포함

- 108개 개별 모델 계열의 PBR 강화 GLB
- 6개 PBR 강화 오피스 씬 GLB
- 8개 스킨/리깅 캐릭터
- 캐릭터마다 12개 내장 애니메이션
- 자유 배치 레이아웃 편집기
- A* 이동 및 충돌 회피
- 좌석/업무 상호작용
- 로컬 저장/불러오기 및 JSON 내보내기
- Three.js/Unity/Godot 연동 소스

## 에셋 제품에 포함하지 않는 서비스 기능

- 계정·조직·권한 백엔드
- WebSocket 멀티플레이 서버
- 텍스트 채팅 저장 서버
- WebRTC 음성·영상회의 서버
- 클라우드 파일 및 캘린더 연동

위 항목은 3D 에셋이 아니라 서비스 애플리케이션 및 인프라 영역입니다.
''')

# npm install / build / validate.
subprocess.run(['npm', 'install', '--no-audit', '--no-fund'], cwd=APP, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
subprocess.run(['npm', 'run', 'validate'], cwd=APP, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
subprocess.run(['npm', 'run', 'build'], cwd=APP, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
# Keep package-lock, remove node_modules from delivery.
shutil.rmtree(APP / 'node_modules', ignore_errors=True)

# Validate enhanced GLBs structurally and count features.
def inspect_glb(path: Path) -> dict[str, Any]:
    try:
        data, _ = read_glb(path)
        attrs = [p.get('attributes', {}) for m in data.get('meshes', []) for p in m.get('primitives', [])]
        return {
            'file': str(path.relative_to(OUT).as_posix()), 'valid': True,
            'meshes': len(data.get('meshes', [])), 'materials': len(data.get('materials', [])),
            'images': len(data.get('images', [])), 'textures': len(data.get('textures', [])),
            'skins': len(data.get('skins', [])), 'animations': len(data.get('animations', [])),
            'all_tri_primitives_have_normals': all('NORMAL' in a for a in attrs) if attrs else True,
            'all_tri_primitives_have_uv0': all('TEXCOORD_0' in a for a in attrs) if attrs else True,
            'bytes': path.stat().st_size,
        }
    except Exception as e:
        return {'file': str(path.relative_to(OUT).as_posix()), 'valid': False, 'error': str(e)}

pbr_glbs = sorted(PBR_MODEL_ROOT.rglob('*.glb')) + sorted(PBR_SCENE_ROOT.glob('*.glb'))
validation_rows = [inspect_glb(p) for p in pbr_glbs]
rigged_rows = [r for r in validation_rows if '/characters_rigged/' in ('/' + r['file'])]
validation = {
    'version': '10.0',
    'status': 'PASS' if all(r['valid'] and r.get('all_tri_primitives_have_normals') and r.get('all_tri_primitives_have_uv0') for r in validation_rows) else 'FAIL',
    'pbr_enhanced_glb_count': len(validation_rows),
    'individual_model_glb_count': len(list(PBR_MODEL_ROOT.rglob('*.glb'))),
    'scene_glb_count': len(list(PBR_SCENE_ROOT.glob('*.glb'))),
    'embedded_image_total': sum(int(r.get('images', 0)) for r in validation_rows),
    'rigged_character_count': len(rigged_rows),
    'rigged_characters_with_12_clips': sum(1 for r in rigged_rows if r.get('animations') == 12),
    'runtime_app_build': 'PASS' if (APP / 'dist' / 'index.html').exists() else 'FAIL',
    'layout_preset_count': len(layouts),
    'asset_registry_count': len(assets_v10),
    'records': validation_rows,
}
dump_json(OUT / '06_quality_reports' / 'validation-report-v10.json', validation)

with (OUT / '06_quality_reports' / 'pbr-glb-report-v10.csv').open('w', newline='', encoding='utf-8-sig') as f:
    keys = ['file', 'valid', 'meshes', 'materials', 'images', 'textures', 'skins', 'animations', 'all_tri_primitives_have_normals', 'all_tri_primitives_have_uv0', 'bytes']
    w = csv.DictWriter(f, fieldnames=keys); w.writeheader()
    for r in validation_rows: w.writerow({k: r.get(k, '') for k in keys})

# Package manifest and hashes.
manifest = {
    'version': '10.0', 'package': OUT.name,
    'primary_files': {
        'asset_registry': '05_registries/asset-registry-v10.json',
        'material_registry': '05_registries/material-registry-v10.json',
        'scene_manifest': '03_scene_prefabs/SCENE_ACME_HQ_RIGGED_RUNTIME_V10_001.json',
        'runtime_app': '11_complete_runtime_app/dist/index.html',
        'launcher': 'run_virtual_office_v10.py',
        'validation': '06_quality_reports/validation-report-v10.json',
    },
    'counts': {
        'registry_assets': len(assets_v10),
        'pbr_model_glbs': len(list(PBR_MODEL_ROOT.rglob('*.glb'))),
        'pbr_scene_glbs': len(list(PBR_SCENE_ROOT.glob('*.glb'))),
        'pbr_texture_sets': len(TEXTURES),
        'layout_presets': len(layouts),
        'rigged_characters': len(rigged_rows),
        'animation_clips_per_character': 12,
    },
    'runtime_features': registry_v10['runtime_capabilities'],
}
dump_json(OUT / 'package-manifest-v10.json', manifest)

hash_lines = []
for p in sorted(OUT.rglob('*')):
    if p.is_file() and p.name != 'sha256sums-v10.txt':
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        hash_lines.append(f'{h}  {p.relative_to(OUT).as_posix()}')
write_text(OUT / '06_quality_reports' / 'sha256sums-v10.txt', '\n'.join(hash_lines))

# Overview image using actual delivery data and concept target thumbnail.
W, H = 1600, 980
canvas = Image.new('RGB', (W, H), '#07101a')
d = ImageDraw.Draw(canvas)
try:
    font_bold = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 48)
    font_sub = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
    font_head = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 25)
    font_body = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 19)
except Exception:
    font_bold = font_sub = font_head = font_body = ImageFont.load_default()

d.rounded_rectangle((22, 20, W-22, H-20), radius=20, fill='#0b1623', outline='#2b3b50', width=2)
d.text((54, 44), 'VIRTUAL OFFICE COMPLETE PRODUCT', font=font_bold, fill='#f1f5fb')
d.rounded_rectangle((1110, 48, 1265, 104), radius=12, fill='#245fd7')
d.text((1140, 58), 'v10.0', font=font_head, fill='white')
d.text((56, 112), 'PBR Embedded GLB · Rigged Characters · 12 Animation Clips · Layout Editor · A* Navigation', font=font_sub, fill='#78a5ff')
ref = OUT / '07_visual_reference' / 'v9_concept_targets' / 'CONCEPT_HERO_OFFICE_SCENE.png'
if ref.exists():
    im = Image.open(ref).convert('RGB'); im.thumbnail((930, 600))
    canvas.paste(im, (50, 170))
    d.rounded_rectangle((48, 168, 48+im.width+4, 168+im.height+4), radius=8, outline='#344a65', width=2)

cards = [
    ('PBR 강화 GLB', f"{validation['pbr_enhanced_glb_count']} files", 'UV0 · normals · 3 maps embedded'),
    ('리깅 캐릭터', f"{validation['rigged_character_count']} avatars", 'skin · skeleton · 12 clips each'),
    ('자유 배치', f"{len(assets_v10)} registry items", 'move · rotate · duplicate · delete'),
    ('캐릭터 이동', 'A* navigation', 'click-to-move · collision avoidance'),
    ('상호작용', 'seat & work anchors', 'sit · stand · typing'),
    ('엔진 연동', 'Three.js · Unity · Godot', 'source code and manifests'),
]
x0, y0 = 1010, 175
for i, (title, value, desc) in enumerate(cards):
    y = y0 + i * 112
    d.rounded_rectangle((x0, y, 1540, y+94), radius=12, fill='#101f30', outline='#263a51')
    d.text((x0+18, y+13), title, font=font_head, fill='#eaf1fa')
    d.text((x0+260, y+15), value, font=font_body, fill='#5f94ff')
    d.text((x0+18, y+56), desc, font=font_body, fill='#8ea0b5')

d.rounded_rectangle((50, 800, 1540, 925), radius=14, fill='#0e1c2b', outline='#293c52')
d.text((72, 820), 'START', font=font_head, fill='#6e9eff')
d.text((72, 858), 'python run_virtual_office_v10.py', font=font_head, fill='#f0f4fa')
d.text((510, 858), '→  http://localhost:8765', font=font_body, fill='#92a7bf')
d.text((1000, 820), f"QA: {validation['status']}", font=font_head, fill='#66d987' if validation['status']=='PASS' else '#ff6868')
d.text((1000, 858), 'Complete real-time development package', font=font_body, fill='#92a7bf')
canvas.save(OVERVIEW, optimize=True)
shutil.copy2(OVERVIEW, OUT / '06_quality_reports' / OVERVIEW.name)

# Recompute overview hash and package zip.
if ZIP_PATH.exists(): ZIP_PATH.unlink()
with zipfile.ZipFile(ZIP_PATH, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zf:
    for p in sorted(OUT.rglob('*')):
        if p.is_file(): zf.write(p, p.relative_to(OUT.parent))

# Verify archive.
with zipfile.ZipFile(ZIP_PATH, 'r') as zf:
    bad = zf.testzip()
    if bad: raise RuntimeError(f'Corrupt ZIP member: {bad}')

print(json.dumps({
    'out': str(OUT), 'zip': str(ZIP_PATH), 'zip_mb': round(ZIP_PATH.stat().st_size / 1024 / 1024, 2),
    'validation': validation['status'], 'pbr_glbs': len(validation_rows), 'assets': len(assets_v10),
    'overview': str(OVERVIEW),
}, ensure_ascii=False, indent=2))
