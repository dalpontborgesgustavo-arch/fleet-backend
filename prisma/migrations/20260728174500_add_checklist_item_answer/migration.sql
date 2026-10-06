ALTER TABLE "ChecklistItem"
ADD COLUMN "answer" TEXT;

UPDATE "ChecklistItem"
SET "answer" = CASE
  WHEN "ok" = TRUE THEN 'OK'
  ELSE 'NC'
END;

ALTER TABLE "ChecklistItem"
ALTER COLUMN "answer" SET NOT NULL,
ALTER COLUMN "answer" SET DEFAULT 'OK';

ALTER TABLE "ChecklistItem"
ADD CONSTRAINT "ChecklistItem_answer_check"
CHECK ("answer" IN ('OK', 'NC', 'NA'));
