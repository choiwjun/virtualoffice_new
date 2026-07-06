"""
Generate a recognizable office tileset PNG for WorkAdventure.

Creates a 4x4 tileset (16 tiles, 128x128 pixels) with distinct visual tiles:
- GID 1: Floor (light beige/gray)
- GID 2: Wall (dark gray/brown)
- GID 3: Desk area (blue tint)
- GID 4: Meeting room floor (green tint)
- GID 5: Focus room floor (purple tint)
- GID 6+: Additional variations

Output: tileset.png (128x128, PNG format)
"""

from __future__ import annotations

import struct
import zlib


def generate_tileset(tile_size: int = 32, columns: int = 4, rows: int = 4) -> bytes:
    """
    Generate a multi-tile PNG tileset with distinct colors for office elements.
    
    Args:
        tile_size: Size of each tile in pixels (default 32x32)
        columns: Number of tile columns (default 4)
        rows: Number of tile rows (default 4)
    
    Returns:
        PNG file bytes
    """
    width = columns * tile_size
    height = rows * tile_size
    
    # Define colors for each GID (RGB tuples)
    tile_colors = [
        (220, 220, 220),  # GID 1: Floor - light gray
        (90, 70, 50),     # GID 2: Wall - dark brown
        (180, 200, 220),  # GID 3: Desk area - light blue
        (200, 230, 200),  # GID 4: Meeting room - light green
        (220, 200, 230),  # GID 5: Focus room - light purple
        (230, 230, 180),  # GID 6: Lobby area - light yellow
        (160, 160, 160),  # GID 7: Corridor - medium gray
        (200, 180, 160),  # GID 8: Storage - beige
        (180, 220, 200),  # GID 9: Break area - mint
        (230, 200, 200),  # GID 10: Private office - light pink
        (190, 190, 190),  # GID 11: Floor variant 2
        (100, 80, 60),    # GID 12: Wall variant 2
        (170, 190, 210),  # GID 13: Desk variant 2
        (190, 220, 190),  # GID 14: Meeting variant 2
        (210, 190, 220),  # GID 15: Focus variant 2
        (240, 240, 200),  # GID 16: Highlight - pale yellow
    ]
    
    # Create pixel data (RGB format, will be converted to indexed if needed)
    # Using truecolor (RGB) for simplicity
    pixels = []
    
    for row in range(rows):
        for y in range(tile_size):
            row_pixels = []
            for col in range(columns):
                tile_idx = row * columns + col
                base_color = tile_colors[tile_idx] if tile_idx < len(tile_colors) else (200, 200, 200)
                
                # Add simple border pattern to make tiles distinguishable
                is_border = (y == 0 or y == tile_size - 1 or 
                           (y % tile_size) < 2 or (y % tile_size) >= tile_size - 2)
                
                for x in range(tile_size):
                    if is_border or x < 2 or x >= tile_size - 2:
                        # Border: slightly darker
                        r = max(0, base_color[0] - 30)
                        g = max(0, base_color[1] - 30)
                        b = max(0, base_color[2] - 30)
                    else:
                        # Interior: base color with subtle gradient
                        gradient = int((x + y) * 0.3) % 20 - 10
                        r = min(255, max(0, base_color[0] + gradient))
                        g = min(255, max(0, base_color[1] + gradient))
                        b = min(255, max(0, base_color[2] + gradient))
                    
                    row_pixels.extend([r, g, b])
            
            pixels.append(bytes(row_pixels))
    
    # Build PNG file
    # PNG format: signature + IHDR + IDAT + IEND
    
    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    # bit_depth=8, color_type=2 (truecolor RGB)
    ihdr = _make_chunk(b'IHDR', ihdr_data)
    
    # IDAT chunk (compressed pixel data)
    raw_data = b''.join(b'\x00' + row for row in pixels)  # filter type 0 (None) per scanline
    compressed = zlib.compress(raw_data, 9)
    idat = _make_chunk(b'IDAT', compressed)
    
    # IEND chunk
    iend = _make_chunk(b'IEND', b'')
    
    return signature + ihdr + idat + iend


def _make_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Create a PNG chunk with length, type, data, and CRC."""
    length = struct.pack('>I', len(data))
    crc = zlib.crc32(chunk_type + data) & 0xffffffff
    crc_bytes = struct.pack('>I', crc)
    return length + chunk_type + data + crc_bytes


if __name__ == "__main__":
    import sys
    from pathlib import Path
    
    output_path = Path(__file__).parent / "tileset.png"
    if len(sys.argv) > 1:
        output_path = Path(sys.argv[1])
    
    tileset_bytes = generate_tileset()
    output_path.write_bytes(tileset_bytes)
    
    print(f"Generated tileset: {output_path}")
    print(f"Size: {len(tileset_bytes)} bytes")
    print(f"Dimensions: 128x128 (4x4 tiles @ 32x32 each)")
    print("\nTile colors:")
    print("  GID 1: Floor (light gray)")
    print("  GID 2: Wall (dark brown)")
    print("  GID 3: Desk area (light blue)")
    print("  GID 4: Meeting room (light green)")
    print("  GID 5: Focus room (light purple)")
    print("  GID 6-16: Variants and special areas")
