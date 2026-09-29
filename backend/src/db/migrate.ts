import { verifySafeDatabase } from './guard';
import { client } from './index';

async function migrateDb() {
  try {
    verifySafeDatabase('Database Schema DDL Migration');

    console.log('🚀 Running database schema DDL initialization...');

    const statements = [
      `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,

      `CREATE TABLE IF NOT EXISTS leagues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL,
        competition_type TEXT NOT NULL DEFAULT 'DOMESTIC_LEAGUE',
        team_count INTEGER NOT NULL DEFAULT 20,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS seasons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        league_id UUID NOT NULL REFERENCES leagues(id),
        name TEXT NOT NULL,
        season_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        current_round INTEGER NOT NULL DEFAULT 0,
        total_rounds INTEGER NOT NULL DEFAULT 38,
        simulation_version TEXT NOT NULL DEFAULT '1.0.0',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        league_id UUID NOT NULL REFERENCES leagues(id),
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        stadium_name TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS team_ratings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES teams(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        overall_ability NUMERIC NOT NULL DEFAULT '75.0',
        attack_strength NUMERIC NOT NULL DEFAULT '1.00',
        defense_strength NUMERIC NOT NULL DEFAULT '1.00',
        creation_rating NUMERIC NOT NULL DEFAULT '1.00',
        finishing_rating NUMERIC NOT NULL DEFAULT '1.00',
        goalkeeping_rating NUMERIC NOT NULL DEFAULT '1.00',
        pressing_rating NUMERIC NOT NULL DEFAULT '1.00',
        discipline_rating NUMERIC NOT NULL DEFAULT '1.00',
        home_advantage NUMERIC NOT NULL DEFAULT '1.10',
        form NUMERIC NOT NULL DEFAULT '0.00',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS team_rating_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES teams(id),
        match_id UUID,
        attribute TEXT NOT NULL,
        before_value NUMERIC NOT NULL,
        after_value NUMERIC NOT NULL,
        delta NUMERIC NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID REFERENCES teams(id),
        name TEXT NOT NULL,
        age INTEGER NOT NULL DEFAULT 24,
        primary_position TEXT NOT NULL,
        secondary_positions JSONB DEFAULT '[]'::jsonb,
        pace INTEGER NOT NULL DEFAULT 70,
        shooting INTEGER NOT NULL DEFAULT 70,
        passing INTEGER NOT NULL DEFAULT 70,
        dribbling INTEGER NOT NULL DEFAULT 70,
        defending INTEGER NOT NULL DEFAULT 70,
        physical INTEGER NOT NULL DEFAULT 70,
        goalkeeping INTEGER NOT NULL DEFAULT 10,
        overall_rating INTEGER NOT NULL DEFAULT 75,
        potential INTEGER NOT NULL DEFAULT 80,
        fitness INTEGER NOT NULL DEFAULT 100,
        stamina INTEGER NOT NULL DEFAULT 80,
        form NUMERIC NOT NULL DEFAULT '0.00',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS player_rating_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        match_id UUID,
        before_rating INTEGER NOT NULL,
        after_rating INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS fixtures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id UUID NOT NULL REFERENCES seasons(id),
        round INTEGER NOT NULL,
        home_team_id UUID NOT NULL REFERENCES teams(id),
        away_team_id UUID NOT NULL REFERENCES teams(id),
        scheduled_at TIMESTAMP NOT NULL,
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        home_score INTEGER DEFAULT 0,
        away_score INTEGER DEFAULT 0,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES fixtures(id) UNIQUE,
        seed TEXT NOT NULL,
        simulation_version TEXT NOT NULL DEFAULT '1.0.0',
        home_lambda NUMERIC NOT NULL DEFAULT '1.20',
        away_lambda NUMERIC NOT NULL DEFAULT '1.00',
        home_score INTEGER NOT NULL DEFAULT 0,
        away_score INTEGER NOT NULL DEFAULT 0,
        virtual_second INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        result_hash TEXT,
        timeline_hash TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS match_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID NOT NULL REFERENCES matches(id),
        virtual_second INTEGER NOT NULL,
        match_state_json JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS match_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES fixtures(id),
        sequence INTEGER NOT NULL,
        virtual_minute INTEGER NOT NULL,
        virtual_second INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        team_id UUID REFERENCES teams(id),
        player_id UUID REFERENCES players(id),
        secondary_player_id UUID REFERENCES players(id),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS match_statistics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES fixtures(id) UNIQUE,
        home_possession INTEGER NOT NULL DEFAULT 50,
        away_possession INTEGER NOT NULL DEFAULT 50,
        home_shots INTEGER NOT NULL DEFAULT 0,
        away_shots INTEGER NOT NULL DEFAULT 0,
        home_shots_on_target INTEGER NOT NULL DEFAULT 0,
        away_shots_on_target INTEGER NOT NULL DEFAULT 0,
        home_corners INTEGER NOT NULL DEFAULT 0,
        away_corners INTEGER NOT NULL DEFAULT 0,
        home_fouls INTEGER NOT NULL DEFAULT 0,
        away_fouls INTEGER NOT NULL DEFAULT 0,
        home_yellow_cards INTEGER NOT NULL DEFAULT 0,
        away_yellow_cards INTEGER NOT NULL DEFAULT 0,
        home_red_cards INTEGER NOT NULL DEFAULT 0,
        away_red_cards INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS player_match_statistics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES fixtures(id),
        player_id UUID NOT NULL REFERENCES players(id),
        team_id UUID NOT NULL REFERENCES teams(id),
        minutes_played INTEGER NOT NULL DEFAULT 0,
        goals INTEGER NOT NULL DEFAULT 0,
        assists INTEGER NOT NULL DEFAULT 0,
        shots INTEGER NOT NULL DEFAULT 0,
        shots_on_target INTEGER NOT NULL DEFAULT 0,
        fouls_committed INTEGER NOT NULL DEFAULT 0,
        yellow_cards INTEGER NOT NULL DEFAULT 0,
        red_cards INTEGER NOT NULL DEFAULT 0,
        rating NUMERIC NOT NULL DEFAULT '6.0',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS standings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id UUID NOT NULL REFERENCES seasons(id),
        team_id UUID NOT NULL REFERENCES teams(id),
        played INTEGER NOT NULL DEFAULT 0,
        won INTEGER NOT NULL DEFAULT 0,
        drawn INTEGER NOT NULL DEFAULT 0,
        lost INTEGER NOT NULL DEFAULT 0,
        goals_for INTEGER NOT NULL DEFAULT 0,
        goals_against INTEGER NOT NULL DEFAULT 0,
        goal_difference INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS markets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES fixtures(id),
        market_type TEXT NOT NULL,
        market_scope TEXT NOT NULL DEFAULT 'FULL_TIME',
        status TEXT NOT NULL DEFAULT 'OPEN',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS market_outcomes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        market_id UUID NOT NULL REFERENCES markets(id),
        outcome_code TEXT NOT NULL,
        display_name TEXT NOT NULL,
        probability NUMERIC NOT NULL,
        odds NUMERIC NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS odds_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        market_id UUID NOT NULL REFERENCES markets(id),
        outcome_code TEXT NOT NULL,
        odds NUMERIC NOT NULL,
        virtual_second INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'USER',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
        currency TEXT NOT NULL DEFAULT 'VIRTUAL',
        balance NUMERIC NOT NULL DEFAULT '10000.00',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS wallet_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        type TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        balance_before NUMERIC NOT NULL,
        balance_after NUMERIC NOT NULL,
        reference_type TEXT,
        reference_id UUID,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS bets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        idempotency_key TEXT UNIQUE,
        stake NUMERIC NOT NULL,
        total_odds NUMERIC NOT NULL,
        potential_payout NUMERIC NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        placed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        settled_at TIMESTAMP
      );`,

      `CREATE TABLE IF NOT EXISTS bet_selections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bet_id UUID NOT NULL REFERENCES bets(id),
        fixture_id UUID NOT NULL REFERENCES fixtures(id),
        market_id UUID NOT NULL REFERENCES markets(id),
        outcome_code TEXT NOT NULL,
        odds NUMERIC NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
      );`,

      `CREATE TABLE IF NOT EXISTS settlements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bet_id UUID NOT NULL REFERENCES bets(id) UNIQUE,
        fixture_id UUID NOT NULL REFERENCES fixtures(id),
        status TEXT NOT NULL,
        payout_amount NUMERIC NOT NULL DEFAULT '0.00',
        settled_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`,

      `CREATE TABLE IF NOT EXISTS simulation_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES fixtures(id),
        simulation_version TEXT NOT NULL,
        seed TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        result_hash TEXT,
        timeline_hash TEXT,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        error TEXT
      );`
    ];

    for (const sqlQuery of statements) {
      await client.unsafe(sqlQuery);
    }

    console.log('✅ Database migration completed successfully!');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message || err);
    process.exit(1);
  }
}

migrateDb();
