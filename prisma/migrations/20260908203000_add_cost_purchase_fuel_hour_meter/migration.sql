ALTER TABLE "CostPurchaseVehicleFuelFact"
ADD COLUMN "usesHourMeter" BOOLEAN,
ADD COLUMN "sourceAverage" DECIMAL(24, 12);

COMMENT ON COLUMN "CostPurchaseVehicleFuelFact"."usesHourMeter" IS
'Snapshot do indicador TRANS_VEICULO.FL_TRABALHAHORIMETRO recebido na sincronizacao Aethos.';

COMMENT ON COLUMN "CostPurchaseVehicleFuelFact"."sourceAverage" IS
'VL_MEDIA informado pelo Aethos, preservado apenas para auditoria e reconciliacao da formula.';
