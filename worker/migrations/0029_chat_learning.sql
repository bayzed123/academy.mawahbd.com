-- The chatbot learns from the team. A question it could not answer is kept (chat_escalations) with how often it was asked; the team writes
-- the right answer once, and that answer is taught to the chatbot (chat_knowledge), which then uses it word for word the next time — so
-- the chatbot grows with the academy without ever guessing. The team can also add an answer by hand, change one, or switch one off.

ALTER TABLE chat_escalations ADD COLUMN asked INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chat_escalations ADD COLUMN last_asked_at TEXT;
ALTER TABLE chat_escalations ADD COLUMN answer TEXT;
ALTER TABLE chat_escalations ADD COLUMN answered_at TEXT;
ALTER TABLE chat_escalations ADD COLUMN answered_by INTEGER REFERENCES staff(id) ON DELETE SET NULL;

CREATE TABLE chat_knowledge (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  -- the language the answer is written in; 'any' = used for both
  lang          TEXT NOT NULL DEFAULT 'any' CHECK (lang IN ('bn','en','any')),
  active        INTEGER NOT NULL DEFAULT 1,
  -- the unanswered question it came from, when it was taught from one
  escalation_id INTEGER REFERENCES chat_escalations(id) ON DELETE SET NULL,
  -- how many times the chatbot has given this answer straight away
  used          INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_chat_knowledge_active ON chat_knowledge(active, lang);
