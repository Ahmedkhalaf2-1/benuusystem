-- DTF / vinyl sale = file length (meters, stored as mm) × copies × price per linear meter.
-- Roll width, file width and copies per row are no longer part of the sale.
-- No data is changed: rows saved under the old rule keep every stored value and
-- must still satisfy the old rule; new rows store no layout and bill exactly
-- file length × quantity. Every branch tests NOT NULL explicitly so a NULL
-- comparison can never let a row pass the check.
ALTER TABLE "order_groups" DROP CONSTRAINT "order_groups_linear_meter_complete";
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_linear_meter_complete" CHECK (
  "pricing_basis" <> 'LINEAR_METER' OR (
    "file_length_mm" IS NOT NULL AND "billable_length_mm" IS NOT NULL
    AND "file_length_mm" > 0 AND "billable_length_mm" > 0
    AND (
      -- current rule
      ("file_width_mm" IS NULL AND "copies_per_row" IS NULL AND "roll_width_mm" IS NULL
        AND "billable_length_mm" = "file_length_mm" * "quantity")
      OR
      -- legacy rule (rows saved before this migration), unchanged
      ("file_width_mm" IS NOT NULL AND "copies_per_row" IS NOT NULL AND "roll_width_mm" IS NOT NULL
        AND "file_width_mm" > 0 AND "copies_per_row" > 0 AND "roll_width_mm" > 0
        AND "file_width_mm" * "copies_per_row" <= "roll_width_mm")
    )
  )
);
