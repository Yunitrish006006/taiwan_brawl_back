#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Dict, Iterable, Tuple

from PIL import Image, ImageDraw


SOURCE_SIZE = 64
OUTPUT_SIZE = 256
SCALE = OUTPUT_SIZE // SOURCE_SIZE

Color = Tuple[int, int, int, int]


TRANSPARENT: Color = (0, 0, 0, 0)
BLACK: Color = (25, 25, 30, 255)
OUTLINE: Color = (18, 18, 22, 255)
WHITE: Color = (235, 232, 218, 255)
SKIN: Color = (219, 165, 118, 255)
SKIN_DARK: Color = (177, 112, 82, 255)
STEEL: Color = (154, 168, 178, 255)
STEEL_DARK: Color = (82, 95, 106, 255)
GOLD: Color = (232, 176, 54, 255)
RED: Color = (194, 57, 55, 255)
BLUE: Color = (56, 113, 191, 255)
GREEN: Color = (69, 155, 91, 255)
PURPLE: Color = (115, 77, 164, 255)
BROWN: Color = (118, 75, 48, 255)


TYPE_ACCENTS: Dict[str, Color] = {
    "melee": (230, 83, 63, 255),
    "tank": (78, 139, 205, 255),
    "ranged": (232, 183, 72, 255),
    "swarm": (93, 179, 101, 255),
}


CARD_ACCENTS: Dict[str, Color] = {
    "guardian": (80, 137, 206, 255),
    "punk": (232, 72, 145, 255),
    "swordsman": (218, 66, 59, 255),
    "asian_parent": (232, 176, 54, 255),
    "giant": (236, 127, 54, 255),
    "knight": (75, 126, 210, 255),
    "archer": (81, 161, 91, 255),
    "bomber": (224, 95, 52, 255),
    "healer": (225, 205, 113, 255),
    "musketeer": (84, 122, 180, 255),
    "goblin_team": (88, 184, 90, 255),
    "wolf_pack": (114, 154, 184, 255),
}


def rgba(color: Tuple[int, int, int] | Color) -> Color:
    if len(color) == 4:
        return color  # type: ignore[return-value]
    return (*color, 255)  # type: ignore[misc]


def shade(color: Color, amount: int) -> Color:
    r, g, b, a = color
    return (
        max(0, min(255, r + amount)),
        max(0, min(255, g + amount)),
        max(0, min(255, b + amount)),
        a,
    )


def scale_up(image: Image.Image) -> Image.Image:
    return image.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.NEAREST)


def new_sprite() -> Image.Image:
    return Image.new("RGBA", (SOURCE_SIZE, SOURCE_SIZE), TRANSPARENT)


def draw_noise(draw: ImageDraw.ImageDraw, rng: random.Random, colors: Iterable[Color]) -> None:
    palette = list(colors)
    for _ in range(90):
        x = rng.randrange(0, SOURCE_SIZE)
        y = rng.randrange(0, SOURCE_SIZE)
        w = rng.choice((1, 1, 2))
        h = rng.choice((1, 1, 2))
        draw.rectangle((x, y, x + w, y + h), fill=rng.choice(palette))


def draw_city_blocks(draw: ImageDraw.ImageDraw, rng: random.Random, color: Color) -> None:
    x = 0
    while x < SOURCE_SIZE:
        width = rng.randrange(5, 12)
        height = rng.randrange(12, 28)
        top = 34 - height
        draw.rectangle((x, top, x + width, 34), fill=shade(color, rng.randrange(-18, 14)))
        for wx in range(x + 2, x + width - 1, 4):
            for wy in range(top + 3, 34, 6):
                if rng.random() < 0.45:
                    draw.rectangle((wx, wy, wx + 1, wy + 1), fill=(238, 187, 75, 255))
        x += width + rng.randrange(1, 3)


def draw_background(card: Dict[str, str], output: Path) -> None:
    card_id = card["id"]
    card_type = card["type"]
    accent = CARD_ACCENTS.get(card_id, TYPE_ACCENTS.get(card_type, BLUE))
    rng = random.Random(card_id)
    image = new_sprite()
    draw = ImageDraw.Draw(image)

    sky_top = shade(accent, -92)
    sky_bottom = shade(accent, -45)
    for y in range(SOURCE_SIZE):
        mix = y / (SOURCE_SIZE - 1)
        color = tuple(
            int(sky_top[i] * (1 - mix) + sky_bottom[i] * mix) for i in range(3)
        ) + (255,)
        draw.line((0, y, SOURCE_SIZE, y), fill=color)

    draw_noise(draw, rng, (shade(sky_top, 8), shade(sky_bottom, -10)))

    if card_id in {"guardian", "punk", "goblin_team"}:
        draw_city_blocks(draw, rng, (48, 55, 68, 255))
        draw.rectangle((0, 35, 63, 63), fill=(36, 39, 46, 255))
        draw.polygon((24, 35, 40, 35, 52, 63, 12, 63), fill=(46, 48, 55, 255))
        draw.line((7, 43, 24, 39), fill=accent, width=1)
        draw.line((41, 39, 58, 43), fill=accent, width=1)
        if card_id == "punk":
            draw.rectangle((4, 25, 22, 33), fill=(40, 210, 207, 255))
            draw.rectangle((6, 27, 20, 30), fill=(246, 242, 205, 255))
        if card_id == "goblin_team":
            draw.rectangle((45, 39, 56, 47), fill=(34, 80, 55, 255))
            draw.ellipse((8, 42, 22, 50), fill=(42, 52, 60, 255))

    elif card_id in {"swordsman", "healer"}:
        draw.rectangle((0, 37, 63, 63), fill=(72, 64, 52, 255))
        draw.rectangle((8, 20, 56, 37), fill=(138, 45, 39, 255))
        draw.rectangle((12, 16, 52, 22), fill=(188, 87, 53, 255))
        draw.rectangle((16, 24, 48, 37), fill=(94, 44, 39, 255))
        draw.rectangle((29, 27, 35, 37), fill=(232, 186, 80, 255))
        for x in range(0, 64, 8):
            draw.line((x, 44, x + 9, 44), fill=(108, 96, 75, 255))
        if card_id == "healer":
            draw.ellipse((23, 8, 41, 26), fill=(226, 193, 83, 255))
            draw.ellipse((27, 12, 37, 22), fill=shade(sky_bottom, -15))

    elif card_id == "asian_parent":
        draw.rectangle((0, 0, 63, 63), fill=(86, 77, 64, 255))
        draw.rectangle((5, 8, 58, 45), fill=(104, 93, 78, 255))
        draw.rectangle((10, 13, 25, 27), fill=(142, 43, 38, 255))
        draw.rectangle((37, 13, 52, 27), fill=(202, 170, 83, 255))
        draw.rectangle((0, 45, 63, 63), fill=(67, 56, 47, 255))
        draw.rectangle((8, 49, 20, 57), fill=(38, 33, 30, 255))
        draw.rectangle((42, 48, 56, 58), fill=(44, 35, 31, 255))

    elif card_id in {"giant", "bomber"}:
        draw.rectangle((0, 30, 63, 63), fill=(47, 43, 39, 255))
        for x in range(6, 63, 13):
            draw.line((x, 10, x, 56), fill=(92, 86, 74, 255), width=2)
            draw.line((x - 5, 22, x + 7, 12), fill=(92, 86, 74, 255), width=1)
        draw.rectangle((4, 42, 60, 45), fill=(212, 139, 40, 255))
        draw.rectangle((8, 48, 56, 51), fill=(212, 139, 40, 255))
        if card_id == "bomber":
            for cx, cy in ((13, 37), (50, 34), (31, 47)):
                draw.ellipse((cx - 2, cy - 2, cx + 2, cy + 2), fill=(241, 111, 54, 255))
                draw.rectangle((cx - 1, cy - 5, cx + 1, cy - 3), fill=(255, 225, 111, 255))

    elif card_id in {"knight", "musketeer"}:
        draw_city_blocks(draw, rng, (48, 60, 82, 255))
        draw.rectangle((0, 36, 63, 63), fill=(53, 57, 66, 255))
        for x in range(0, 64, 9):
            draw.line((x, 43, x + 7, 43), fill=(82, 87, 96, 255))
        if card_id == "knight":
            draw.rectangle((8, 20, 14, 40), fill=accent)
            draw.rectangle((49, 20, 55, 40), fill=accent)
        else:
            draw.rectangle((5, 38, 58, 45), fill=(85, 61, 49, 255))
            draw.rectangle((8, 31, 55, 38), fill=(78, 83, 91, 255))

    elif card_id == "archer":
        draw_city_blocks(draw, rng, (42, 56, 68, 255))
        draw.rectangle((0, 39, 63, 63), fill=(49, 48, 49, 255))
        draw.rectangle((3, 34, 61, 39), fill=(70, 66, 60, 255))
        for x in range(5, 60, 14):
            draw.line((x, 28, x + 6, 39), fill=(221, 222, 204, 255), width=1)

    elif card_id == "wolf_pack":
        draw.rectangle((0, 33, 63, 63), fill=(39, 54, 57, 255))
        draw.polygon((0, 37, 14, 21, 28, 37), fill=(51, 73, 79, 255))
        draw.polygon((18, 37, 37, 14, 58, 37), fill=(59, 82, 88, 255))
        draw.polygon((37, 38, 52, 22, 63, 38), fill=(49, 69, 75, 255))
        draw.rectangle((0, 47, 63, 63), fill=(35, 38, 42, 255))
        draw.line((0, 51, 63, 42), fill=(86, 96, 101, 255), width=2)

    else:
        draw.rectangle((0, 36, 63, 63), fill=shade(accent, -70))

    output.parent.mkdir(parents=True, exist_ok=True)
    scale_up(image).save(output, format="PNG", optimize=True)


def rect(draw: ImageDraw.ImageDraw, xy: Tuple[int, int, int, int], fill: Color) -> None:
    draw.rectangle(xy, fill=fill)


def common_humanoid(
    draw: ImageDraw.ImageDraw,
    *,
    x: int,
    y: int,
    body: Color,
    accent: Color,
    head: Color = SKIN,
    hair: Color = BLACK,
    armor: bool = False,
) -> None:
    rect(draw, (x + 18, y + 46, x + 23, y + 56), OUTLINE)
    rect(draw, (x + 33, y + 46, x + 38, y + 56), OUTLINE)
    rect(draw, (x + 19, y + 46, x + 23, y + 54), shade(body, -45))
    rect(draw, (x + 34, y + 46, x + 38, y + 54), shade(body, -45))
    rect(draw, (x + 16, y + 22, x + 40, y + 45), OUTLINE)
    rect(draw, (x + 19, y + 24, x + 37, y + 44), body)
    rect(draw, (x + 20, y + 26, x + 36, y + 31), accent)
    rect(draw, (x + 14, y + 25, x + 18, y + 40), OUTLINE)
    rect(draw, (x + 39, y + 25, x + 43, y + 40), OUTLINE)
    rect(draw, (x + 15, y + 26, x + 18, y + 38), shade(body, -28))
    rect(draw, (x + 39, y + 26, x + 42, y + 38), shade(body, -28))
    rect(draw, (x + 22, y + 9, x + 35, y + 22), OUTLINE)
    rect(draw, (x + 23, y + 11, x + 34, y + 21), head)
    rect(draw, (x + 23, y + 8, x + 34, y + 13), hair)
    rect(draw, (x + 26, y + 15, x + 27, y + 16), OUTLINE)
    rect(draw, (x + 31, y + 15, x + 32, y + 16), OUTLINE)
    if armor:
        rect(draw, (x + 21, y + 23, x + 35, y + 42), STEEL)
        rect(draw, (x + 22, y + 25, x + 34, y + 29), shade(STEEL, 30))
        rect(draw, (x + 20, y + 31, x + 36, y + 35), accent)


def draw_guardian(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(42, 47, 55, 255), accent=accent, hair=(30, 32, 36, 255))
    rect(draw, (17, 34, 46, 37), (88, 70, 46, 255))
    rect(draw, (44, 33, 49, 38), OUTLINE)


def draw_punk(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(34, 38, 46, 255), accent=accent, hair=(44, 216, 205, 255))
    rect(draw, (26, 7, 35, 10), (44, 216, 205, 255))
    rect(draw, (22, 31, 37, 33), GOLD)
    rect(draw, (12, 37, 17, 42), SKIN_DARK)
    rect(draw, (41, 37, 46, 42), SKIN_DARK)


def draw_swordsman(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(66, 70, 77, 255), accent=accent, armor=True)
    draw.line((43, 15, 57, 5), fill=STEEL, width=2)
    draw.line((44, 17, 58, 7), fill=OUTLINE, width=1)
    rect(draw, (40, 18, 44, 21), GOLD)


def draw_asian_parent(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(83, 96, 102, 255), accent=(241, 232, 196, 255), hair=(44, 37, 33, 255))
    rect(draw, (23, 25, 35, 43), (241, 232, 196, 255))
    rect(draw, (24, 26, 34, 28), accent)
    rect(draw, (43, 33, 51, 37), (139, 78, 47, 255))
    rect(draw, (50, 34, 53, 36), OUTLINE)


def draw_giant(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=1, y=-2, body=(117, 89, 61, 255), accent=accent, head=(202, 132, 88, 255), hair=(68, 50, 36, 255))
    rect(draw, (18, 24, 42, 46), (91, 78, 66, 255))
    rect(draw, (20, 14, 38, 25), (202, 132, 88, 255))
    rect(draw, (20, 9, 38, 14), (231, 150, 53, 255))
    rect(draw, (13, 39, 19, 46), (90, 65, 43, 255))
    rect(draw, (41, 39, 47, 46), (90, 65, 43, 255))


def draw_knight(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=STEEL_DARK, accent=accent, head=STEEL, hair=STEEL_DARK, armor=True)
    rect(draw, (21, 7, 36, 15), STEEL)
    rect(draw, (25, 11, 32, 13), OUTLINE)
    draw.polygon((10, 26, 21, 29, 20, 44, 9, 40), fill=OUTLINE)
    draw.polygon((11, 28, 19, 30, 18, 41, 10, 38), fill=accent)
    draw.line((44, 19, 54, 40), fill=STEEL, width=2)


def draw_archer(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(61, 86, 58, 255), accent=accent, hair=(57, 43, 32, 255))
    draw.arc((38, 16, 57, 45), 260, 100, fill=(142, 91, 47, 255), width=2)
    draw.line((47, 18, 47, 43), fill=(222, 211, 166, 255), width=1)
    draw.line((33, 29, 51, 28), fill=STEEL, width=1)


def draw_bomber(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(73, 63, 54, 255), accent=accent, hair=(48, 38, 31, 255))
    rect(draw, (24, 14, 34, 17), (72, 150, 170, 255))
    rect(draw, (15, 32, 22, 40), (97, 64, 40, 255))
    draw.ellipse((43, 35, 51, 43), fill=OUTLINE)
    draw.ellipse((45, 36, 50, 41), fill=(52, 54, 57, 255))
    rect(draw, (47, 32, 48, 35), (255, 219, 86, 255))


def draw_healer(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(222, 222, 200, 255), accent=accent, hair=(75, 48, 36, 255))
    rect(draw, (21, 23, 36, 45), (226, 218, 195, 255))
    rect(draw, (24, 25, 33, 43), (143, 45, 50, 255))
    draw.line((43, 17, 43, 45), fill=(122, 73, 38, 255), width=2)
    rect(draw, (40, 15, 46, 18), GOLD)
    for x, y in ((19, 31), (21, 33), (37, 31), (35, 33)):
        draw.ellipse((x, y, x + 2, y + 2), fill=GOLD)


def draw_musketeer(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    common_humanoid(draw, x=4, y=2, body=(41, 55, 75, 255), accent=accent, hair=(43, 34, 28, 255))
    rect(draw, (20, 8, 37, 11), (61, 45, 33, 255))
    rect(draw, (17, 6, 40, 8), (61, 45, 33, 255))
    draw.line((38, 27, 57, 22), fill=(86, 59, 39, 255), width=3)
    draw.line((52, 21, 61, 19), fill=STEEL, width=2)


def draw_goblin(draw: ImageDraw.ImageDraw, x: int, y: int, body: Color, accent: Color) -> None:
    rect(draw, (x + 3, y + 16, x + 8, y + 23), OUTLINE)
    rect(draw, (x + 11, y + 16, x + 16, y + 23), OUTLINE)
    rect(draw, (x + 4, y + 15, x + 15, y + 20), body)
    rect(draw, (x + 5, y + 20, x + 14, y + 31), accent)
    rect(draw, (x + 3, y + 6, x + 16, y + 15), OUTLINE)
    rect(draw, (x + 4, y + 7, x + 15, y + 14), body)
    draw.polygon((x + 1, y + 9, x + 4, y + 11, x + 2, y + 14), fill=body)
    draw.polygon((x + 18, y + 9, x + 15, y + 11, x + 17, y + 14), fill=body)
    rect(draw, (x + 7, y + 10, x + 8, y + 11), OUTLINE)
    rect(draw, (x + 12, y + 10, x + 13, y + 11), OUTLINE)


def draw_goblin_team(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    draw_goblin(draw, 6, 20, (94, 168, 73, 255), accent)
    draw_goblin(draw, 22, 14, (78, 151, 69, 255), shade(accent, -25))
    draw_goblin(draw, 38, 20, (106, 180, 78, 255), shade(accent, -45))
    rect(draw, (12, 43, 49, 46), (113, 74, 44, 255))
    rect(draw, (47, 39, 52, 45), STEEL)


def draw_wolf(draw: ImageDraw.ImageDraw, x: int, y: int, fur: Color, accent: Color) -> None:
    draw.polygon((x + 4, y + 17, x + 12, y + 9, x + 26, y + 10, x + 34, y + 18, x + 26, y + 25, x + 11, y + 25), fill=OUTLINE)
    draw.polygon((x + 6, y + 17, x + 13, y + 11, x + 25, y + 12, x + 31, y + 18, x + 25, y + 23, x + 12, y + 23), fill=fur)
    draw.polygon((x + 5, y + 14, x + 2, y + 7, x + 10, y + 12), fill=fur)
    draw.polygon((x + 24, y + 12, x + 28, y + 5, x + 30, y + 15), fill=fur)
    rect(draw, (x + 11, y + 24, x + 14, y + 32), OUTLINE)
    rect(draw, (x + 24, y + 24, x + 27, y + 32), OUTLINE)
    rect(draw, (x + 29, y + 17, x + 31, y + 18), accent)


def draw_wolf_pack(draw: ImageDraw.ImageDraw, accent: Color) -> None:
    draw_wolf(draw, 3, 23, (83, 91, 96, 255), accent)
    draw_wolf(draw, 20, 15, (105, 113, 116, 255), shade(accent, 20))
    draw_wolf(draw, 32, 25, (69, 76, 82, 255), shade(accent, -20))


CHARACTER_DRAWERS = {
    "guardian": draw_guardian,
    "punk": draw_punk,
    "swordsman": draw_swordsman,
    "asian_parent": draw_asian_parent,
    "giant": draw_giant,
    "knight": draw_knight,
    "archer": draw_archer,
    "bomber": draw_bomber,
    "healer": draw_healer,
    "musketeer": draw_musketeer,
    "goblin_team": draw_goblin_team,
    "wolf_pack": draw_wolf_pack,
}


def draw_character(card: Dict[str, str], output: Path) -> None:
    card_id = card["id"]
    card_type = card["type"]
    accent = CARD_ACCENTS.get(card_id, TYPE_ACCENTS.get(card_type, BLUE))
    image = new_sprite()
    draw = ImageDraw.Draw(image)
    draw.ellipse((14, 55, 50, 61), fill=(0, 0, 0, 65))

    drawer = CHARACTER_DRAWERS.get(card_id)
    if drawer is None:
        common_humanoid(draw, x=4, y=2, body=shade(accent, -55), accent=accent)
    else:
        drawer(draw, accent)

    output.parent.mkdir(parents=True, exist_ok=True)
    scale_up(image).save(output, format="PNG", optimize=True)


def load_cards(manifest: Path) -> list[Dict[str, str]]:
    with manifest.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return [
        {
            "id": str(card["id"]),
            "name": str(card.get("name", card["id"])),
            "type": str(card.get("type", "melee")),
        }
        for card in data
    ]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate simple 256x256 pixel-art card character and background assets."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("tools/card_art/manifest.json"),
        help="Card art manifest JSON.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("generated/card_art_pixel"),
        help="Output directory containing one folder per card.",
    )
    args = parser.parse_args()

    cards = load_cards(args.manifest)
    for card in cards:
        card_dir = args.output / card["id"]
        draw_character(card, card_dir / "character.png")
        draw_background(card, card_dir / "bg.png")

    print(f"Generated {len(cards)} pixel-art card bundles in {args.output}")


if __name__ == "__main__":
    main()
