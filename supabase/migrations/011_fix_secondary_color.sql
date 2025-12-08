-- Fix secondary_color column to allow longer strings (patterns, gradients, etc.)
-- The original VARCHAR(7) only allowed hex colors like #ff0000
-- We need TEXT to store patterns like "pattern|🐱|ff0000|ffffff"

ALTER TABLE forums 
ALTER COLUMN secondary_color TYPE TEXT;

-- Add a dedicated background_url column for flexibility
ALTER TABLE forums 
ADD COLUMN IF NOT EXISTS background_url TEXT;
