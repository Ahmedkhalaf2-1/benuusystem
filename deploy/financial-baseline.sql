-- Benuuprint ERP — read-only financial baseline.
-- Run before and after a migration and diff the output; it must be identical
-- (except for new tables). Never writes:
--   psql -At -v ON_ERROR_STOP=1 -d benuuprint -c 'SET default_transaction_read_only = on' -f deploy/financial-baseline.sql
SET default_transaction_read_only = on;
SELECT 'count:' || t, n FROM (
  SELECT 'users' t, count(*) n FROM users UNION ALL
  SELECT 'customers', count(*) FROM customers UNION ALL
  SELECT 'orders', count(*) FROM orders UNION ALL
  SELECT 'order_groups', count(*) FROM order_groups UNION ALL
  SELECT 'order_group_designs', count(*) FROM order_group_designs UNION ALL
  SELECT 'order_group_sizes', count(*) FROM order_group_sizes UNION ALL
  SELECT 'order_payments', count(*) FROM order_payments UNION ALL
  SELECT 'order_costs', count(*) FROM order_costs UNION ALL
  SELECT 'general_expenses', count(*) FROM general_expenses UNION ALL
  SELECT 'outgoing_payments', count(*) FROM outgoing_payments UNION ALL
  SELECT 'suppliers', count(*) FROM suppliers UNION ALL
  SELECT 'workers', count(*) FROM workers UNION ALL
  SELECT 'worker_workdays', count(*) FROM worker_workdays UNION ALL
  SELECT 'worker_work_logs', count(*) FROM worker_work_logs UNION ALL
  SELECT 'production_stage_progress', count(*) FROM production_stage_progress UNION ALL
  SELECT 'production_ready', count(*) FROM production_ready UNION ALL
  SELECT 'deliveries', count(*) FROM deliveries
) c ORDER BY 1;
SELECT 'sum:orders_total_price_active', COALESCE(SUM(total_price),0) FROM orders WHERE archived_at IS NULL AND status <> 'CANCELLED';
SELECT 'sum:customer_payments_valid', COALESCE(SUM(amount),0) FROM order_payments WHERE voided_at IS NULL;
SELECT 'sum:customer_payments_voided', COALESCE(SUM(amount),0) FROM order_payments WHERE voided_at IS NOT NULL;
SELECT 'sum:outgoing_payments_valid', COALESCE(SUM(amount),0) FROM outgoing_payments WHERE voided_at IS NULL;
SELECT 'sum:outgoing_payments_voided', COALESCE(SUM(amount),0) FROM outgoing_payments WHERE voided_at IS NOT NULL;
SELECT 'sum:order_costs_valid', COALESCE(SUM(amount),0) FROM order_costs WHERE voided_at IS NULL;
SELECT 'sum:general_expenses_valid', COALESCE(SUM(amount),0) FROM general_expenses WHERE voided_at IS NULL;
SELECT 'sum:worker_wages_valid', COALESCE(SUM(wage),0) FROM worker_workdays WHERE voided_at IS NULL;
SELECT 'md5:orders', md5(COALESCE(string_agg(row(id,number,customer_id,title,quantity,total_price,status,pricing,archived_at,completed_at)::text,'|' ORDER BY id),'')) FROM orders;
SELECT 'md5:order_payments', md5(COALESCE(string_agg(row(id,order_id,amount,paid_at,method,is_advance,idempotency_key,voided_at,void_reason)::text,'|' ORDER BY id),'')) FROM order_payments;
SELECT 'md5:outgoing_payments', md5(COALESCE(string_agg(row(id,order_cost_id,expense_id,worker_id,worker_payment_type,amount,paid_at,method,idempotency_key,voided_at)::text,'|' ORDER BY id),'')) FROM outgoing_payments;
SELECT 'md5:order_costs', md5(COALESCE(string_agg(row(c.*)::text,'|' ORDER BY id),'')) FROM order_costs c;
SELECT 'md5:general_expenses', md5(COALESCE(string_agg(row(e.*)::text,'|' ORDER BY id),'')) FROM general_expenses e;
SELECT 'md5:order_groups', md5(COALESCE(string_agg(row(g.*)::text,'|' ORDER BY id),'')) FROM order_groups g;
SELECT 'md5:deliveries', md5(COALESCE(string_agg(row(d.*)::text,'|' ORDER BY id),'')) FROM deliveries d;
SELECT 'md5:production_ready', md5(COALESCE(string_agg(row(r.*)::text,'|' ORDER BY id),'')) FROM production_ready r;
