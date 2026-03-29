ALTER TABLE cards ADD COLUMN name_zh_hant TEXT NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN name_ja TEXT NOT NULL DEFAULT '';

UPDATE cards
SET
  name_zh_hant = CASE WHEN TRIM(name_zh_hant) = '' THEN name ELSE name_zh_hant END,
  name_en = CASE WHEN TRIM(name_en) = '' THEN name ELSE name_en END,
  name_ja = CASE WHEN TRIM(name_ja) = '' THEN name ELSE name_ja END;

UPDATE cards
SET
  name_en = CASE id
    WHEN 'swordsman' THEN 'Swordsman'
    WHEN 'guardian' THEN 'Guardian'
    WHEN 'knight' THEN 'Knight'
    WHEN 'giant' THEN 'Giant'
    WHEN 'archer' THEN 'Archer'
    WHEN 'musketeer' THEN 'Musketeer'
    WHEN 'bomber' THEN 'Bomber'
    WHEN 'wolf_pack' THEN 'Wolf Pack'
    WHEN 'goblin_team' THEN 'Goblin Team'
    WHEN 'fireball' THEN 'Fireball'
    WHEN 'zap' THEN 'Zap'
    WHEN 'healer' THEN 'Healer'
    WHEN 'iron_blade' THEN 'Iron Blade'
    WHEN 'swift_boots' THEN 'Swift Boots'
    WHEN 'guardian_armor' THEN 'Guardian Armor'
    ELSE name_en
  END,
  name_ja = CASE id
    WHEN 'swordsman' THEN '剣士'
    WHEN 'guardian' THEN 'ガーディアン'
    WHEN 'knight' THEN 'ナイト'
    WHEN 'giant' THEN 'ジャイアント'
    WHEN 'archer' THEN 'アーチャー'
    WHEN 'musketeer' THEN 'マスケット銃士'
    WHEN 'bomber' THEN 'ボマー'
    WHEN 'wolf_pack' THEN 'ウルフパック'
    WHEN 'goblin_team' THEN 'ゴブリンチーム'
    WHEN 'fireball' THEN 'ファイアボール'
    WHEN 'zap' THEN 'ザップ'
    WHEN 'healer' THEN 'ヒーラー'
    WHEN 'iron_blade' THEN '鋼の刃'
    WHEN 'swift_boots' THEN '俊足の靴'
    WHEN 'guardian_armor' THEN '守護の鎧'
    ELSE name_ja
  END;
