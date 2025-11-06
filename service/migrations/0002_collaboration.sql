CREATE TABLE IF NOT EXISTS sheet_collaborators (
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','commenter','editor')),
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sheet_collaborators_user ON sheet_collaborators(user_id);

