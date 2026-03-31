-- Run once per database if column users.role uses enum users_role_enum
-- (fixes: invalid input value for enum users_role_enum: "STAFF")

ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS 'STAFF';

-- Then:
-- UPDATE users SET role = 'STAFF' WHERE email = 'cleaner@test.com';
