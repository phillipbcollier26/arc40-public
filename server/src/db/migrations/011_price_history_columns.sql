-- 011: fund price history import (V2 Phase 2).
-- The daily closing prices themselves go in price_points with source 'history' (migration 010).
-- This remembers, per fund, which columns of the user's price file hold the date and the closing price,
-- when Arc40 could not recognize them itself (like the saved column mapping for bank files).
CREATE TABLE price_history_columns (
  symbol       TEXT    PRIMARY KEY REFERENCES securities(symbol) ON DELETE CASCADE,
  date_column  TEXT    NOT NULL CHECK (length(date_column) BETWEEN 1 AND 100),
  price_column TEXT    NOT NULL CHECK (length(price_column) BETWEEN 1 AND 100),
  updated_at   INTEGER NOT NULL
);
