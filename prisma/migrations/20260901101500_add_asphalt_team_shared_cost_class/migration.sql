BEGIN;

ALTER TABLE "UsinaOperationalCostFact"
  DROP CONSTRAINT "UsinaOperationalCostFact_class_check";

ALTER TABLE "UsinaOperationalCostFact"
  ADD CONSTRAINT "UsinaOperationalCostFact_class_check"
  CHECK (
    "costClass" IN (
      'DIESEL_USINA',
      'MANUTENCAO_USINA',
      'VEHICLE_EXPENSE',
      'OLEO_RESIVALE',
      'CAL_CH1',
      'DOP',
      'MATERIAL_EXPEDIENTE',
      'ENERGIA',
      'MAO_DE_OBRA',
      'BANHEIRO_QUIMICO_EQUIPE_ASFALTO'
    )
  );

COMMIT;
