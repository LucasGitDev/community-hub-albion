-- TASK-066: a posição da espera era um contador que nunca reaproveitava número, então a fila gravada
-- ficou com buracos (sobrava só o "3º" depois que o 1º e o 2º saíram). O repo já renumera daqui pra
-- frente; isto arruma o que ficou gravado, para a API não devolver buraco em evento que ninguém tocou.
-- A nova ordem é a ordem antiga (position, created_at), então ninguém troca de lugar na fila.
UPDATE "event_signups" AS s
SET "position" = r.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "slot_id" ORDER BY "position", "created_at", "id") AS rn
  FROM "event_signups"
  WHERE "status" = 'waitlist'
) AS r
WHERE s."id" = r."id" AND s."position" <> r.rn;
