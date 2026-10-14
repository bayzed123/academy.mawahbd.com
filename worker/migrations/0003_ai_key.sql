-- Optional admin-saved provider key, stored AES-GCM encrypted (key derived from APP_SECRET). The plain key is never stored or returned.
ALTER TABLE ai_provider_configs ADD COLUMN key_enc TEXT;
