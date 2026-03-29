ALTER TABLE cards ADD COLUMN name_i18n TEXT NOT NULL DEFAULT '{}';

UPDATE cards
SET name_i18n = json_object(
  'zh-Hant',
  CASE
    WHEN TRIM(COALESCE(name_zh_hant, '')) != '' THEN TRIM(name_zh_hant)
    WHEN TRIM(COALESCE(name, '')) != '' THEN TRIM(name)
    ELSE ''
  END,
  'en',
  CASE
    WHEN TRIM(COALESCE(name_en, '')) != '' THEN TRIM(name_en)
    WHEN TRIM(COALESCE(name, '')) != '' THEN TRIM(name)
    ELSE ''
  END,
  'ja',
  CASE
    WHEN TRIM(COALESCE(name_ja, '')) != '' THEN TRIM(name_ja)
    ELSE ''
  END
)
WHERE TRIM(COALESCE(name_i18n, '')) = ''
   OR TRIM(COALESCE(name_i18n, '')) = '{}';
