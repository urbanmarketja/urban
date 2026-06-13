ALTER TABLE jobs
  ADD COLUMN salary_min_jmd INT NOT NULL DEFAULT 0 AFTER salary_jmd,
  ADD COLUMN salary_max_jmd INT NOT NULL DEFAULT 0 AFTER salary_min_jmd;

UPDATE jobs
SET
  salary_min_jmd = CASE WHEN salary_min_jmd = 0 THEN salary_jmd ELSE salary_min_jmd END,
  salary_max_jmd = CASE WHEN salary_max_jmd = 0 THEN salary_jmd ELSE salary_max_jmd END;
