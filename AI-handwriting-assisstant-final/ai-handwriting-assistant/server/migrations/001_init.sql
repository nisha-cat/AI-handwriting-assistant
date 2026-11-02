-- AI Handwriting Assistant - initial schema (MySQL 8+, InnoDB, utf8mb4).
-- All timestamps are stored in UTC (the app sets the session time zone to +00:00).

CREATE TABLE IF NOT EXISTS users (
  id           CHAR(36)     NOT NULL,
  -- SHA-256 of the random session token held in the browser's httpOnly cookie.
  -- The raw token is never stored.
  session_hash CHAR(64)     NOT NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_session_hash (session_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  title           VARCHAR(120) NOT NULL,
  mode            ENUM('notes','exam') NOT NULL DEFAULT 'notes',
  -- Short plain-text preview so list views never have to load the full JSON body.
  excerpt         VARCHAR(255) NOT NULL DEFAULT '',
  -- Full draft: question, raw text, reviewed text, change notes, handwriting settings.
  content         JSON         NOT NULL,
  version         INT UNSIGNED NOT NULL DEFAULT 1,
  -- Client-generated key that makes "create" safe to retry without duplicating documents.
  idempotency_key VARCHAR(64)  NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- NULL keys are allowed to repeat; non-NULL keys are unique per user.
  UNIQUE KEY uq_documents_user_idempotency (user_id, idempotency_key),
  KEY idx_documents_user_updated (user_id, updated_at),
  CONSTRAINT fk_documents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot of the previous state, written before each content update.
CREATE TABLE IF NOT EXISTS document_versions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id CHAR(36)     NOT NULL,
  version     INT UNSIGNED NOT NULL,
  title       VARCHAR(120) NOT NULL,
  content     JSON         NOT NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_versions_document_version (document_id, version),
  CONSTRAINT fk_versions_document FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default handwriting/export settings applied to new documents.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    CHAR(36)     NOT NULL,
  settings   JSON         NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: generated PDFs/PNGs are intentionally NOT stored. Rendering is deterministic, so
-- exports are regenerated on demand from the saved document; no binary blobs live in rows.
