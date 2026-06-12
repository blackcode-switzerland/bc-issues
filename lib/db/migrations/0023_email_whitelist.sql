-- Super admin email whitelist.
-- type='domain' matches any email on that domain (e.g. "blackcode.ch").
-- type='email'  matches only that specific email address.
CREATE TABLE IF NOT EXISTS email_whitelist (
  id         serial PRIMARY KEY,
  type       varchar(10)  NOT NULL,
  value      varchar(255) NOT NULL,
  added_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT email_whitelist_type_check     CHECK (type IN ('email', 'domain')),
  CONSTRAINT uq_email_whitelist_type_value  UNIQUE (type, value)
);
