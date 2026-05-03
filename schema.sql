-- ============================================================
-- つもり貯金 — Supabase セットアップ SQL
-- Supabase ダッシュボード → SQL Editor で実行してください
-- ============================================================

-- ─── missions テーブル ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS missions (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_name         TEXT        NOT NULL,
  target_amount     INTEGER     NOT NULL CHECK (target_amount > 0),
  current_amount    INTEGER     NOT NULL DEFAULT 0,
  image_path        TEXT,                                  -- Storage オブジェクトパス
  unrevealed_blocks INTEGER[]   NOT NULL DEFAULT '{}',     -- シャッフル済み未解放ブロック
  completed         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Row Level Security ──────────────────────────────────────
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_missions" ON missions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own_missions" ON missions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_missions" ON missions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "delete_own_missions" ON missions
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Storage バケット ────────────────────────────────────────
-- ダッシュボード → Storage → New bucket でも作成できます
INSERT INTO storage.buckets (id, name, public)
VALUES ('mission-images', 'mission-images', false)
ON CONFLICT (id) DO NOTHING;

-- ─── Storage RLS ─────────────────────────────────────────────
-- パス形式: {user_id}/{timestamp}.{ext}
-- split_part(name, '/', 1) で先頭フォルダ(= user_id)を取得して照合

CREATE POLICY "upload_own_images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mission-images'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "read_own_images" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'mission-images'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "delete_own_images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'mission-images'
    AND split_part(name, '/', 1) = auth.uid()::text
  );
