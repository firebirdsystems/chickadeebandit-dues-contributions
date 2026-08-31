-- Index the manifest `preload` read, which the hub runs server-side while
-- rendering this app's document — on every launch, for every household.
--
-- preload.assessments takes the newest 500 and was sorting every assessment
-- row to do it. Assessments accumulate one per billing cycle forever, so this
-- is the read that degrades with the age of the association, not its size.
CREATE INDEX IF NOT EXISTS app_dues_contributions__assessments_created_idx
  ON app_dues_contributions__assessments (created_at DESC);
