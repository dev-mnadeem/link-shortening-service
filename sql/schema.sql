-- Table DDL only. The database itself is created by `npm run db:init`, which
-- reads DB_NAME from the environment; hardcoding `CREATE DATABASE` /  `USE`
-- here meant the schema always landed in `url_shortener` even when the app was
-- configured to connect somewhere else.
--
-- To apply by hand instead:
--   mysql -u root -e "CREATE DATABASE IF NOT EXISTS url_shortener"
--   mysql -u root url_shortener < sql/schema.sql

CREATE TABLE IF NOT EXISTS urls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  short_code VARCHAR(16) NOT NULL,
  original_url TEXT NOT NULL,
  click_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Carries both lookup and collision detection: the redirect path seeks on
  -- it, and INSERT relies on it to reject a duplicate code rather than the
  -- application doing a racy SELECT-then-INSERT.
  UNIQUE KEY uq_urls_short_code (short_code),
  KEY idx_urls_created_at (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS url_clicks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  url_id BIGINT UNSIGNED NOT NULL,
  clicked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(64) NOT NULL,
  user_agent TEXT NOT NULL,
  PRIMARY KEY (id),
  -- Composite rather than two single-column indexes: every analytics read is
  -- "clicks for this url over this period", which this serves from the index
  -- alone. It also still satisfies lookups on url_id by itself.
  KEY idx_url_clicks_url_id_clicked_at (url_id, clicked_at),
  KEY idx_url_clicks_clicked_at (clicked_at),
  CONSTRAINT fk_url_clicks_url_id
    FOREIGN KEY (url_id) REFERENCES urls(id)
    ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
