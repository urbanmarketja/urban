ALTER TABLE products
  ADD COLUMN stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0);
