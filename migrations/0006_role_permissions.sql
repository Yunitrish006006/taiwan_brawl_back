UPDATE users
SET role = 'card_manager'
WHERE role IN ('card manager', 'card-manager', 'cardManager');

UPDATE users
SET role = 'user'
WHERE role IS NULL
   OR TRIM(role) = ''
   OR role IN ('normal user', 'normal_user', 'normal-user');
