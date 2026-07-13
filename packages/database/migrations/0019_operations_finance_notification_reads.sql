ALTER TABLE player_notifications DROP CONSTRAINT player_notifications_check;
ALTER TABLE player_notifications ADD CONSTRAINT player_notifications_read_time_check
  CHECK (read_at IS NULL OR read_at >= created_at);

CREATE INDEX dated_flights_airline_board_idx
  ON dated_flights (route_id, departure_at, id);
CREATE INDEX flight_transition_offline_changes_idx
  ON flight_transition_history (effective_at DESC, flight_id, sequence DESC);

COMMENT ON CONSTRAINT player_notifications_read_time_check ON player_notifications IS
  'Both timestamps use the PostgreSQL clock. Application clocks must not be written into read_at.';
