ALTER TABLE users ADD COLUMN google_avatar_url TEXT;
ALTER TABLE users ADD COLUMN custom_avatar_url TEXT;
ALTER TABLE users ADD COLUMN avatar_source TEXT NOT NULL DEFAULT 'google';

UPDATE users
SET
  google_avatar_url = CASE
    WHEN google_sub IS NOT NULL THEN avatar_url
    ELSE google_avatar_url
  END,
  custom_avatar_url = CASE
    WHEN google_sub IS NULL THEN avatar_url
    ELSE custom_avatar_url
  END,
  avatar_source = CASE
    WHEN google_sub IS NOT NULL THEN 'google'
    ELSE 'custom'
  END
WHERE google_avatar_url IS NULL
  AND custom_avatar_url IS NULL;
