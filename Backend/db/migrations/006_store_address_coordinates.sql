ALTER TABLE stores
  ADD COLUMN address_line_1 VARCHAR(255) NULL AFTER location;

ALTER TABLE stores
  ADD COLUMN address_line_2 VARCHAR(255) NULL AFTER address_line_1;

ALTER TABLE stores
  ADD COLUMN parish VARCHAR(120) NULL AFTER address_line_2;

ALTER TABLE stores
  ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER parish;

ALTER TABLE stores
  ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude;

ALTER TABLE customer_addresses
  ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER parish;

ALTER TABLE customer_addresses
  ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude;

UPDATE stores
SET address_line_1 = COALESCE(address_line_1, location),
    parish = COALESCE(parish, CASE
      WHEN LOWER(location) LIKE '%portmore%' THEN 'St. Catherine'
      WHEN LOWER(location) LIKE '%spanish town%' THEN 'St. Catherine'
      WHEN LOWER(location) LIKE '%half way tree%' THEN 'St. Andrew'
      ELSE parish
    END),
    latitude = COALESCE(latitude, CASE
      WHEN LOWER(location) LIKE '%half way tree%' THEN 18.0125000
      WHEN LOWER(location) LIKE '%portmore%' THEN 17.9503000
      WHEN LOWER(location) LIKE '%spanish town%' THEN 17.9911000
      ELSE NULL
    END),
    longitude = COALESCE(longitude, CASE
      WHEN LOWER(location) LIKE '%half way tree%' THEN -76.7981000
      WHEN LOWER(location) LIKE '%portmore%' THEN -76.8827000
      WHEN LOWER(location) LIKE '%spanish town%' THEN -76.9574000
      ELSE NULL
    END);
