UPDATE users
SET role = 'player'
WHERE role IS NULL
   OR TRIM(role) = ''
   OR role IN ('user', 'normal user', 'normal_user', 'normal-user');
