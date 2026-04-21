#!/usr/bin/env python3

import argparse
from pathlib import Path
from typing import Tuple

from PIL import Image


def parse_rgb(value: str) -> Tuple[int, int, int]:
    parts = [int(part.strip()) for part in value.split(",")]
    if len(parts) != 3:
        raise ValueError("RGB value must have exactly 3 comma-separated integers")
    return tuple(max(0, min(255, part)) for part in parts)


def is_neutral_light(pixel, brightness_floor: int, chroma_ceiling: int) -> bool:
    r, g, b = pixel[:3]
    return min(r, g, b) >= brightness_floor and max(r, g, b) - min(r, g, b) <= chroma_ceiling


def make_character_alpha(
    source: Path,
    output: Path,
    canvas_width: int,
    canvas_height: int,
    padding_ratio: float,
    brightness_floor: int,
    chroma_ceiling: int,
) -> None:
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    pixels = image.load()

    background = [[False] * height for _ in range(width)]
    stack = []

    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))

    while stack:
      x, y = stack.pop()
      if x < 0 or x >= width or y < 0 or y >= height:
        continue
      if background[x][y]:
        continue
      if not is_neutral_light(pixels[x, y], brightness_floor, chroma_ceiling):
        continue
      background[x][y] = True
      stack.append((x + 1, y))
      stack.append((x - 1, y))
      stack.append((x, y + 1))
      stack.append((x, y - 1))

    opaque_bounds = [width, height, -1, -1]
    for x in range(width):
        for y in range(height):
            r, g, b, a = pixels[x, y]
            if background[x][y]:
                pixels[x, y] = (r, g, b, 0)
                continue
            opaque_bounds[0] = min(opaque_bounds[0], x)
            opaque_bounds[1] = min(opaque_bounds[1], y)
            opaque_bounds[2] = max(opaque_bounds[2], x)
            opaque_bounds[3] = max(opaque_bounds[3], y)

    if opaque_bounds[2] < opaque_bounds[0] or opaque_bounds[3] < opaque_bounds[1]:
        raise RuntimeError(f"Could not detect foreground in {source}")

    cropped = image.crop(
        (
            opaque_bounds[0],
            opaque_bounds[1],
            opaque_bounds[2] + 1,
            opaque_bounds[3] + 1,
        )
    )

    available_width = int(canvas_width * (1 - padding_ratio * 2))
    available_height = int(canvas_height * (1 - padding_ratio * 2))
    ratio = min(available_width / cropped.width, available_height / cropped.height)
    resized = cropped.resize(
        (max(1, int(cropped.width * ratio)), max(1, int(cropped.height * ratio))),
        Image.LANCZOS,
    )

    canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
    offset = (
        (canvas_width - resized.width) // 2,
        (canvas_height - resized.height) // 2,
    )
    canvas.alpha_composite(resized, offset)

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, format="PNG", optimize=True)


def make_background(
    source: Path,
    output: Path,
    width: int,
    height: int,
    quality: int,
    matte_rgb: Tuple[int, int, int],
) -> None:
    image = Image.open(source).convert("RGBA")
    matte = Image.new("RGBA", image.size, (*matte_rgb, 255))
    flattened = Image.alpha_composite(matte, image).convert("RGB")

    source_ratio = flattened.width / flattened.height
    target_ratio = width / height
    if source_ratio > target_ratio:
        crop_width = int(flattened.height * target_ratio)
        left = (flattened.width - crop_width) // 2
        cropped = flattened.crop((left, 0, left + crop_width, flattened.height))
    else:
        crop_height = int(flattened.width / target_ratio)
        top = (flattened.height - crop_height) // 2
        cropped = flattened.crop((0, top, flattened.width, top + crop_height))

    resized = cropped.resize((width, height), Image.LANCZOS)
    output.parent.mkdir(parents=True, exist_ok=True)
    resized.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    character = subparsers.add_parser("character")
    character.add_argument("source", type=Path)
    character.add_argument("output", type=Path)
    character.add_argument("--canvas-width", type=int, default=768)
    character.add_argument("--canvas-height", type=int, default=1152)
    character.add_argument("--padding-ratio", type=float, default=0.08)
    character.add_argument("--brightness-floor", type=int, default=185)
    character.add_argument("--chroma-ceiling", type=int, default=36)

    background = subparsers.add_parser("background")
    background.add_argument("source", type=Path)
    background.add_argument("output", type=Path)
    background.add_argument("--width", type=int, default=1280)
    background.add_argument("--height", type=int, default=720)
    background.add_argument("--quality", type=int, default=84)
    background.add_argument("--matte-rgb", default="8,12,18")

    args = parser.parse_args()
    if args.command == "character":
        make_character_alpha(
            source=args.source,
            output=args.output,
            canvas_width=args.canvas_width,
            canvas_height=args.canvas_height,
            padding_ratio=args.padding_ratio,
            brightness_floor=args.brightness_floor,
            chroma_ceiling=args.chroma_ceiling,
        )
        return

    make_background(
        source=args.source,
        output=args.output,
        width=args.width,
        height=args.height,
        quality=args.quality,
        matte_rgb=parse_rgb(args.matte_rgb),
    )


if __name__ == "__main__":
    main()
