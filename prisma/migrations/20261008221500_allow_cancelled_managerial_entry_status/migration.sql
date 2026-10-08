-- Cancelled Aethos invoices remain as auditable inactive facts.
ALTER TABLE "CostPurchaseManagerialEntryFact"
  DROP CONSTRAINT "CostPurchaseManagerialEntry_status_check",
  ADD CONSTRAINT "CostPurchaseManagerialEntry_status_check"
    CHECK ("sourceStatus" IN ('F', 'C'));
