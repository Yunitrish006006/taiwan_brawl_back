ALTER TABLE users ADD COLUMN llm_base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1';
ALTER TABLE users ADD COLUMN llm_model TEXT NOT NULL DEFAULT 'gpt-4o-mini';
ALTER TABLE users ADD COLUMN llm_api_key TEXT;
