-- =====================================================================
-- 004_sms_app_login.sql | Enable LOGIN and set password for sms_app role
-- =====================================================================
DO $$
DECLARE
  v_pw TEXT := COALESCE(NULLIF(current_setting('app.sms_app_password', true), ''), 'sms_app_password');
BEGIN
  EXECUTE format('ALTER ROLE sms_app WITH LOGIN PASSWORD %L', v_pw);
END $$;
