-- A placa e o ID Aethos sao as identidades unicas. O Aethos possui numeros
-- oficiais de frota repetidos entre ativos, portanto a frota nao pode ser uma
-- restricao global no banco.
DROP INDEX IF EXISTS "Vehicle_fleet_normalized_key";
