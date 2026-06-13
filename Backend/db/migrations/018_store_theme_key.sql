SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'stores'
    AND column_name = 'theme_key'
);
SET @sql = IF(@column_exists = 0, 'ALTER TABLE stores ADD COLUMN theme_key VARCHAR(40) NOT NULL DEFAULT ''street'' AFTER longitude', 'SELECT "theme_key already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'stores'
    AND column_name = 'theme_primary_color'
);
SET @sql = IF(@column_exists = 0, 'ALTER TABLE stores ADD COLUMN theme_primary_color CHAR(7) AFTER theme_key', 'SELECT "theme_primary_color already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'stores'
    AND column_name = 'theme_accent_color'
);
SET @sql = IF(@column_exists = 0, 'ALTER TABLE stores ADD COLUMN theme_accent_color CHAR(7) AFTER theme_primary_color', 'SELECT "theme_accent_color already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'stores'
    AND column_name = 'theme_background_color'
);
SET @sql = IF(@column_exists = 0, 'ALTER TABLE stores ADD COLUMN theme_background_color CHAR(7) AFTER theme_accent_color', 'SELECT "theme_background_color already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
