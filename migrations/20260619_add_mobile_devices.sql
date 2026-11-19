-- Mobile push/device registration foundation for native app compatibility.
CREATE TABLE IF NOT EXISTS mobile_devices (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR NOT NULL,
  device_token TEXT NOT NULL,
  push_provider VARCHAR NOT NULL DEFAULT 'expo',
  app_version VARCHAR,
  device_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_devices_user_id
  ON mobile_devices(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_devices_user_token
  ON mobile_devices(user_id, device_token);
