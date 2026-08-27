-- Public bucket for per-user Twitch alert sound uploads (overlay reads via public URL)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'alert-sounds',
  'alert-sounds',
  true,
  5242880,
  ARRAY['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read alert sounds" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own alert sounds" ON storage.objects;
DROP POLICY IF EXISTS "Users update own alert sounds" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own alert sounds" ON storage.objects;

CREATE POLICY "Public read alert sounds"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'alert-sounds');

CREATE POLICY "Users upload own alert sounds"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'alert-sounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own alert sounds"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'alert-sounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'alert-sounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own alert sounds"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'alert-sounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
