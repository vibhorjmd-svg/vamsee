ALTER TABLE organizations ADD COLUMN brand_name TEXT;
ALTER TABLE organizations ADD COLUMN brand_primary_color TEXT NOT NULL DEFAULT '#102b46';
ALTER TABLE organizations ADD COLUMN brand_accent_color TEXT NOT NULL DEFAULT '#f49b45';
ALTER TABLE organizations ADD COLUMN brand_logo_url TEXT;
