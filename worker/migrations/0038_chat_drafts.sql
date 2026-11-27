-- The chatbot learns by itself, with the owner's say-so: a question it could not answer is given to the AI (Gemini, Admin → AI) with the
-- academy's own facts — the classes and their prices today, the FAQ, the answers already approved — and the answer it writes waits here
-- for the team (Admin → Chatbot → Questions). One click approves it: it is then taught (chat_knowledge) and given word for word from then
-- on. When the facts do not hold the answer, nothing is written (the team answers it themselves); a failed try is tried again later.
--   draft_state: 'ready' (an answer waits for approval) | 'no_facts' (the facts do not hold it) | 'failed' (the AI could not be reached)
--                | 'no_ai' (no AI is set up) | NULL (not tried yet)
ALTER TABLE chat_escalations ADD COLUMN draft TEXT;
ALTER TABLE chat_escalations ADD COLUMN draft_state TEXT;
ALTER TABLE chat_escalations ADD COLUMN drafted_at TEXT;
