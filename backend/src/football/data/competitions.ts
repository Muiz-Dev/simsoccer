export interface SeedTeam {
  name: string;
  shortName: string;
  slug: string;
  stadiumName: string;
  attackStrength: number;
  defenseStrength: number;
  overallRating: number;
}

export interface SeedCompetition {
  leagueName: string;
  slug: string;
  country: string;
  provenance: {
    source: string;
    sourceUrl: string;
    retrievedAt: string;
    season: string;
    attributeSource: string;
  };
  teams: SeedTeam[];
}

export const COMPETITIONS_DATA_BY_SEASON: Record<string, Record<string, SeedCompetition>> = {
  '2025-2026': {
    'premier-league': {
      leagueName: 'Premier League',
      slug: 'premier-league',
      country: 'England',
      provenance: {
        source: 'Premier League Official Clubs & Standings Data',
        sourceUrl: 'https://www.premierleague.com/clubs',
        retrievedAt: '2026-09-29',
        season: '2025-2026',
        attributeSource: 'SIM_SOCCER_MODEL_ESTIMATE',
      },
      teams: [
        { name: 'Arsenal', shortName: 'ARS', slug: 'arsenal', stadiumName: 'Emirates Stadium', attackStrength: 1.25, defenseStrength: 1.30, overallRating: 86 },
        { name: 'Aston Villa', shortName: 'AVL', slug: 'aston-villa', stadiumName: 'Villa Park', attackStrength: 1.12, defenseStrength: 1.05, overallRating: 80 },
        { name: 'Bournemouth', shortName: 'BOU', slug: 'bournemouth', stadiumName: 'Vitality Stadium', attackStrength: 0.95, defenseStrength: 0.90, overallRating: 75 },
        { name: 'Brentford', shortName: 'BRE', slug: 'brentford', stadiumName: 'Gtech Community Stadium', attackStrength: 0.98, defenseStrength: 0.92, overallRating: 76 },
        { name: 'Brighton & Hove Albion', shortName: 'BHA', slug: 'brighton', stadiumName: 'AMEX Stadium', attackStrength: 1.05, defenseStrength: 1.00, overallRating: 78 },
        { name: 'Chelsea', shortName: 'CHE', slug: 'chelsea', stadiumName: 'Stamford Bridge', attackStrength: 1.18, defenseStrength: 1.10, overallRating: 82 },
        { name: 'Crystal Palace', shortName: 'CRY', slug: 'crystal-palace', stadiumName: 'Selhurst Park', attackStrength: 0.92, defenseStrength: 0.95, overallRating: 75 },
        { name: 'Everton', shortName: 'EVE', slug: 'everton', stadiumName: 'Goodison Park', attackStrength: 0.88, defenseStrength: 0.94, overallRating: 74 },
        { name: 'Fulham', shortName: 'FUL', slug: 'fulham', stadiumName: 'Craven Cottage', attackStrength: 0.96, defenseStrength: 0.95, overallRating: 76 },
        { name: 'Ipswich Town', shortName: 'IPS', slug: 'ipswich', stadiumName: 'Portman Road', attackStrength: 0.85, defenseStrength: 0.82, overallRating: 72 },
        { name: 'Leicester City', shortName: 'LEI', slug: 'leicester', stadiumName: 'King Power Stadium', attackStrength: 0.90, defenseStrength: 0.85, overallRating: 74 },
        { name: 'Liverpool', shortName: 'LIV', slug: 'liverpool', stadiumName: 'Anfield', attackStrength: 1.30, defenseStrength: 1.25, overallRating: 87 },
        { name: 'Manchester City', shortName: 'MCI', slug: 'man-city', stadiumName: 'Etihad Stadium', attackStrength: 1.35, defenseStrength: 1.28, overallRating: 88 },
        { name: 'Manchester United', shortName: 'MUN', slug: 'man-utd', stadiumName: 'Old Trafford', attackStrength: 1.10, defenseStrength: 1.08, overallRating: 81 },
        { name: 'Newcastle United', shortName: 'NEW', slug: 'newcastle', stadiumName: "St. James' Park", attackStrength: 1.12, defenseStrength: 1.08, overallRating: 80 },
        { name: 'Nottingham Forest', shortName: 'NFO', slug: 'nottingham-forest', stadiumName: 'City Ground', attackStrength: 0.92, defenseStrength: 0.90, overallRating: 74 },
        { name: 'Southampton', shortName: 'SOU', slug: 'southampton', stadiumName: "St Mary's Stadium", attackStrength: 0.82, defenseStrength: 0.80, overallRating: 71 },
        { name: 'Tottenham Hotspur', shortName: 'TOT', slug: 'tottenham', stadiumName: 'Tottenham Hotspur Stadium', attackStrength: 1.15, defenseStrength: 1.05, overallRating: 81 },
        { name: 'West Ham United', shortName: 'WHU', slug: 'west-ham', stadiumName: 'London Stadium', attackStrength: 1.02, defenseStrength: 0.98, overallRating: 77 },
        { name: 'Wolverhampton Wanderers', shortName: 'WOL', slug: 'wolves', stadiumName: 'Molineux Stadium', attackStrength: 0.90, defenseStrength: 0.92, overallRating: 75 },
      ],
    },
    'la-liga': {
      leagueName: 'La Liga',
      slug: 'la-liga',
      country: 'Spain',
      provenance: {
        source: 'La Liga EA Sports Official Clubs Data',
        sourceUrl: 'https://www.laliga.com/en-GB/laliga-easports/clubs',
        retrievedAt: '2026-09-29',
        season: '2025-2026',
        attributeSource: 'SIM_SOCCER_MODEL_ESTIMATE',
      },
      teams: [
        { name: 'Athletic Club', shortName: 'ATH', slug: 'athletic-club', stadiumName: 'San Mamés', attackStrength: 1.08, defenseStrength: 1.15, overallRating: 80 },
        { name: 'Atlético Madrid', shortName: 'ATM', slug: 'atletico-madrid', stadiumName: 'Cívitas Metropolitano', attackStrength: 1.20, defenseStrength: 1.25, overallRating: 84 },
        { name: 'FC Barcelona', shortName: 'BAR', slug: 'barcelona', stadiumName: 'Spotify Camp Nou', attackStrength: 1.32, defenseStrength: 1.22, overallRating: 87 },
        { name: 'Celta Vigo', shortName: 'CEL', slug: 'celta-vigo', stadiumName: 'Abanca-Balaídos', attackStrength: 0.95, defenseStrength: 0.90, overallRating: 75 },
        { name: 'RCD Espanyol', shortName: 'ESP', slug: 'espanyol', stadiumName: 'RCDE Stadium', attackStrength: 0.85, defenseStrength: 0.84, overallRating: 73 },
        { name: 'Getafe CF', shortName: 'GET', slug: 'getafe', stadiumName: 'Coliseum Alfonso Pérez', attackStrength: 0.80, defenseStrength: 1.05, overallRating: 75 },
        { name: 'Girona FC', shortName: 'GIR', slug: 'girona', stadiumName: 'Montilivi', attackStrength: 1.10, defenseStrength: 1.00, overallRating: 79 },
        { name: 'UD Las Palmas', shortName: 'LPA', slug: 'las-palmas', stadiumName: 'Estadio Gran Canaria', attackStrength: 0.88, defenseStrength: 0.92, overallRating: 74 },
        { name: 'CD Leganés', shortName: 'LEG', slug: 'leganes', stadiumName: 'Butarque', attackStrength: 0.82, defenseStrength: 0.85, overallRating: 72 },
        { name: 'RCD Mallorca', shortName: 'RMA', slug: 'mallorca', stadiumName: 'Estadi Mallorca Son Moix', attackStrength: 0.86, defenseStrength: 0.95, overallRating: 75 },
        { name: 'CA Osasuna', shortName: 'OSA', slug: 'osasuna', stadiumName: 'El Sadar', attackStrength: 0.92, defenseStrength: 0.96, overallRating: 76 },
        { name: 'Rayo Vallecano', shortName: 'RAY', slug: 'rayo-vallecano', stadiumName: 'Estadio de Vallecas', attackStrength: 0.90, defenseStrength: 0.92, overallRating: 75 },
        { name: 'Real Betis', shortName: 'BET', slug: 'real-betis', stadiumName: 'Benito Villamarín', attackStrength: 1.08, defenseStrength: 1.04, overallRating: 79 },
        { name: 'Real Madrid', shortName: 'RMD', slug: 'real-madrid', stadiumName: 'Santiago Bernabéu', attackStrength: 1.38, defenseStrength: 1.30, overallRating: 89 },
        { name: 'Real Sociedad', shortName: 'RSO', slug: 'real-sociedad', stadiumName: 'Reale Arena', attackStrength: 1.10, defenseStrength: 1.12, overallRating: 81 },
        { name: 'Sevilla FC', shortName: 'SEV', slug: 'sevilla', stadiumName: 'Ramón Sánchez-Pizjuán', attackStrength: 1.00, defenseStrength: 1.00, overallRating: 77 },
        { name: 'Valencia CF', shortName: 'VAL', slug: 'valencia', stadiumName: 'Mestalla', attackStrength: 0.96, defenseStrength: 0.95, overallRating: 76 },
        { name: 'Real Valladolid', shortName: 'VLD', slug: 'valladolid', stadiumName: 'José Zorrilla', attackStrength: 0.82, defenseStrength: 0.82, overallRating: 72 },
        { name: 'Villarreal CF', shortName: 'VIL', slug: 'villarreal', stadiumName: 'Estadio de la Cerámica', attackStrength: 1.12, defenseStrength: 1.02, overallRating: 80 },
        { name: 'Deportivo Alavés', shortName: 'ALA', slug: 'alaves', stadiumName: 'Mendizorrotza', attackStrength: 0.88, defenseStrength: 0.92, overallRating: 74 },
      ],
    },
    'serie-a': {
      leagueName: 'Serie A',
      slug: 'serie-a',
      country: 'Italy',
      provenance: {
        source: 'Lega Serie A Official Clubs Data',
        sourceUrl: 'https://www.legaseriea.it/en/serie-a/clubs',
        retrievedAt: '2026-09-29',
        season: '2025-2026',
        attributeSource: 'SIM_SOCCER_MODEL_ESTIMATE',
      },
      teams: [
        { name: 'Atalanta', shortName: 'ATA', slug: 'atalanta', stadiumName: 'Gewiss Stadium', attackStrength: 1.22, defenseStrength: 1.08, overallRating: 82 },
        { name: 'Bologna', shortName: 'BOL', slug: 'bologna', stadiumName: "Stadio Renato Dall'Ara", attackStrength: 1.08, defenseStrength: 1.10, overallRating: 79 },
        { name: 'Cagliari', shortName: 'CAG', slug: 'cagliari', stadiumName: 'Unipol Domus', attackStrength: 0.86, defenseStrength: 0.88, overallRating: 73 },
        { name: 'Como', shortName: 'COM', slug: 'como', stadiumName: 'Stadio Giuseppe Sinigaglia', attackStrength: 0.88, defenseStrength: 0.85, overallRating: 73 },
        { name: 'Empoli', shortName: 'EMP', slug: 'empoli', stadiumName: 'Stadio Carlo Castellani', attackStrength: 0.84, defenseStrength: 0.88, overallRating: 73 },
        { name: 'Fiorentina', shortName: 'FIO', slug: 'fiorentina', stadiumName: 'Stadio Artemio Franchi', attackStrength: 1.08, defenseStrength: 1.02, overallRating: 78 },
        { name: 'Genoa', shortName: 'GEN', slug: 'genoa', stadiumName: 'Stadio Luigi Ferraris', attackStrength: 0.90, defenseStrength: 0.95, overallRating: 75 },
        { name: 'Hellas Verona', shortName: 'VER', slug: 'hellas-verona', stadiumName: 'Stadio Marcantonio Bentegodi', attackStrength: 0.85, defenseStrength: 0.88, overallRating: 73 },
        { name: 'Inter Milan', shortName: 'INT', slug: 'inter-milan', stadiumName: 'San Siro', attackStrength: 1.34, defenseStrength: 1.30, overallRating: 88 },
        { name: 'Juventus', shortName: 'JUV', slug: 'juventus', stadiumName: 'Allianz Stadium', attackStrength: 1.20, defenseStrength: 1.25, overallRating: 85 },
        { name: 'Lazio', shortName: 'LAZ', slug: 'lazio', stadiumName: 'Stadio Olimpico', attackStrength: 1.12, defenseStrength: 1.08, overallRating: 80 },
        { name: 'Lecce', shortName: 'LEC', slug: 'lecce', stadiumName: 'Stadio Via del Mare', attackStrength: 0.82, defenseStrength: 0.86, overallRating: 72 },
        { name: 'AC Milan', shortName: 'MIL', slug: 'ac-milan', stadiumName: 'San Siro', attackStrength: 1.25, defenseStrength: 1.18, overallRating: 84 },
        { name: 'Monza', shortName: 'MON', slug: 'monza', stadiumName: 'UPower Stadium', attackStrength: 0.88, defenseStrength: 0.92, overallRating: 74 },
        { name: 'Napoli', shortName: 'NAP', slug: 'napoli', stadiumName: 'Stadio Diego Armando Maradona', attackStrength: 1.26, defenseStrength: 1.20, overallRating: 85 },
        { name: 'Parma', shortName: 'PAR', slug: 'parma', stadiumName: 'Stadio Ennio Tardini', attackStrength: 0.88, defenseStrength: 0.86, overallRating: 73 },
        { name: 'AS Roma', shortName: 'ROM', slug: 'as-roma', stadiumName: 'Stadio Olimpico', attackStrength: 1.14, defenseStrength: 1.10, overallRating: 81 },
        { name: 'Torino', shortName: 'TOR', slug: 'torino', stadiumName: 'Stadio Olimpico Grande Torino', attackStrength: 0.94, defenseStrength: 1.02, overallRating: 76 },
        { name: 'Udinese', shortName: 'UDI', slug: 'udinese', stadiumName: 'Bluenergy Stadium', attackStrength: 0.92, defenseStrength: 0.94, overallRating: 75 },
        { name: 'Venezia', shortName: 'VEN', slug: 'venezia', stadiumName: 'Stadio Pier Luigi Penzo', attackStrength: 0.82, defenseStrength: 0.82, overallRating: 71 },
      ],
    },
  },
  '2026-2027': {
    'premier-league': {
      leagueName: 'Premier League',
      slug: 'premier-league',
      country: 'England',
      provenance: {
        source: 'Premier League Official Clubs & Promotion/Relegation Data',
        sourceUrl: 'https://www.premierleague.com/clubs',
        retrievedAt: '2026-09-29',
        season: '2026-2027',
        attributeSource: 'SIM_SOCCER_MODEL_ESTIMATE',
      },
      teams: [
        { name: 'Arsenal', shortName: 'ARS', slug: 'arsenal', stadiumName: 'Emirates Stadium', attackStrength: 1.28, defenseStrength: 1.32, overallRating: 87 },
        { name: 'Aston Villa', shortName: 'AVL', slug: 'aston-villa', stadiumName: 'Villa Park', attackStrength: 1.14, defenseStrength: 1.06, overallRating: 81 },
        { name: 'Bournemouth', shortName: 'BOU', slug: 'bournemouth', stadiumName: 'Vitality Stadium', attackStrength: 0.96, defenseStrength: 0.92, overallRating: 76 },
        { name: 'Brentford', shortName: 'BRE', slug: 'brentford', stadiumName: 'Gtech Community Stadium', attackStrength: 0.98, defenseStrength: 0.93, overallRating: 76 },
        { name: 'Brighton & Hove Albion', shortName: 'BHA', slug: 'brighton', stadiumName: 'AMEX Stadium', attackStrength: 1.06, defenseStrength: 1.02, overallRating: 79 },
        { name: 'Burnley', shortName: 'BUR', slug: 'burnley', stadiumName: 'Turf Moor', attackStrength: 0.88, defenseStrength: 0.86, overallRating: 74 },
        { name: 'Chelsea', shortName: 'CHE', slug: 'chelsea', stadiumName: 'Stamford Bridge', attackStrength: 1.20, defenseStrength: 1.12, overallRating: 83 },
        { name: 'Crystal Palace', shortName: 'CRY', slug: 'crystal-palace', stadiumName: 'Selhurst Park', attackStrength: 0.94, defenseStrength: 0.96, overallRating: 76 },
        { name: 'Everton', shortName: 'EVE', slug: 'everton', stadiumName: 'Everton Stadium', attackStrength: 0.90, defenseStrength: 0.95, overallRating: 75 },
        { name: 'Fulham', shortName: 'FUL', slug: 'fulham', stadiumName: 'Craven Cottage', attackStrength: 0.97, defenseStrength: 0.95, overallRating: 76 },
        { name: 'Leeds United', shortName: 'LEE', slug: 'leeds-united', stadiumName: 'Elland Road', attackStrength: 0.92, defenseStrength: 0.88, overallRating: 75 },
        { name: 'Liverpool', shortName: 'LIV', slug: 'liverpool', stadiumName: 'Anfield', attackStrength: 1.32, defenseStrength: 1.26, overallRating: 88 },
        { name: 'Manchester City', shortName: 'MCI', slug: 'man-city', stadiumName: 'Etihad Stadium', attackStrength: 1.36, defenseStrength: 1.28, overallRating: 88 },
        { name: 'Manchester United', shortName: 'MUN', slug: 'man-utd', stadiumName: 'Old Trafford', attackStrength: 1.12, defenseStrength: 1.08, overallRating: 81 },
        { name: 'Newcastle United', shortName: 'NEW', slug: 'newcastle', stadiumName: "St. James' Park", attackStrength: 1.14, defenseStrength: 1.10, overallRating: 81 },
        { name: 'Nottingham Forest', shortName: 'NFO', slug: 'nottingham-forest', stadiumName: 'City Ground', attackStrength: 0.94, defenseStrength: 0.92, overallRating: 75 },
        { name: 'Sunderland', shortName: 'SUN', slug: 'sunderland', stadiumName: 'Stadium of Light', attackStrength: 0.86, defenseStrength: 0.85, overallRating: 73 },
        { name: 'Tottenham Hotspur', shortName: 'TOT', slug: 'tottenham', stadiumName: 'Tottenham Hotspur Stadium', attackStrength: 1.16, defenseStrength: 1.06, overallRating: 82 },
        { name: 'West Ham United', shortName: 'WHU', slug: 'west-ham', stadiumName: 'London Stadium', attackStrength: 1.02, defenseStrength: 0.98, overallRating: 77 },
        { name: 'Wolverhampton Wanderers', shortName: 'WOL', slug: 'wolves', stadiumName: 'Molineux Stadium', attackStrength: 0.90, defenseStrength: 0.92, overallRating: 75 },
      ],
    },
    'la-liga': {
      leagueName: 'La Liga',
      slug: 'la-liga',
      country: 'Spain',
      provenance: {
        source: 'La Liga EA Sports Official Clubs & Promotion/Relegation Data',
        sourceUrl: 'https://www.laliga.com/en-GB/laliga-easports/clubs',
        retrievedAt: '2026-09-29',
        season: '2026-2027',
        attributeSource: 'SIM_SOCCER_MODEL_ESTIMATE',
      },
      teams: [
        { name: 'Athletic Club', shortName: 'ATH', slug: 'athletic-club', stadiumName: 'San Mamés', attackStrength: 1.10, defenseStrength: 1.16, overallRating: 81 },
        { name: 'Atlético Madrid', shortName: 'ATM', slug: 'atletico-madrid', stadiumName: 'Cívitas Metropolitano', attackStrength: 1.22, defenseStrength: 1.26, overallRating: 85 },
        { name: 'FC Barcelona', shortName: 'BAR', slug: 'barcelona', stadiumName: 'Spotify Camp Nou', attackStrength: 1.34, defenseStrength: 1.24, overallRating: 88 },
        { name: 'Celta Vigo', shortName: 'CEL', slug: 'celta-vigo', stadiumName: 'Abanca-Balaídos', attackStrength: 0.96, defenseStrength: 0.91, overallRating: 75 },
        { name: 'Elche CF', shortName: 'ELC', slug: 'elche', stadiumName: 'Manuel Martínez Valero', attackStrength: 0.84, defenseStrength: 0.83, overallRating: 73 },
        { name: 'Getafe CF', shortName: 'GET', slug: 'getafe', stadiumName: 'Coliseum Alfonso Pérez', attackStrength: 0.82, defenseStrength: 1.06, overallRating: 76 },
        { name: 'Girona FC', shortName: 'GIR', slug: 'girona', stadiumName: 'Montilivi', attackStrength: 1.12, defenseStrength: 1.02, overallRating: 80 },
        { name: 'Levante UD', shortName: 'LEV', slug: 'levante', stadiumName: 'Ciutat de València', attackStrength: 0.86, defenseStrength: 0.84, overallRating: 73 },
        { name: 'UD Las Palmas', shortName: 'LPA', slug: 'las-palmas', stadiumName: 'Estadio Gran Canaria', attackStrength: 0.88, defenseStrength: 0.92, overallRating: 74 },
        { name: 'RCD Mallorca', shortName: 'RMA', slug: 'mallorca', stadiumName: 'Estadi Mallorca Son Moix', attackStrength: 0.88, defenseStrength: 0.96, overallRating: 76 },
        { name: 'CA Osasuna', shortName: 'OSA', slug: 'osasuna', stadiumName: 'El Sadar', attackStrength: 0.93, defenseStrength: 0.96, overallRating: 76 },
        { name: 'Rayo Vallecano', shortName: 'RAY', slug: 'rayo-vallecano', stadiumName: 'Estadio de Vallecas', attackStrength: 0.91, defenseStrength: 0.93, overallRating: 75 },
        { name: 'Real Betis', shortName: 'BET', slug: 'real-betis', stadiumName: 'Benito Villamarín', attackStrength: 1.10, defenseStrength: 1.05, overallRating: 80 },
        { name: 'Real Madrid', shortName: 'RMD', slug: 'real-madrid', stadiumName: 'Santiago Bernabéu', attackStrength: 1.40, defenseStrength: 1.32, overallRating: 90 },
        { name: 'Real Sociedad', shortName: 'RSO', slug: 'real-sociedad', stadiumName: 'Reale Arena', attackStrength: 1.12, defenseStrength: 1.14, overallRating: 82 },
        { name: 'Sevilla FC', shortName: 'SEV', slug: 'sevilla', stadiumName: 'Ramón Sánchez-Pizjuán', attackStrength: 1.02, defenseStrength: 1.02, overallRating: 78 },
        { name: 'Valencia CF', shortName: 'VAL', slug: 'valencia', stadiumName: 'Mestalla', attackStrength: 0.98, defenseStrength: 0.96, overallRating: 77 },
        { name: 'Villarreal CF', shortName: 'VIL', slug: 'villarreal', stadiumName: 'Estadio de la Cerámica', attackStrength: 1.14, defenseStrength: 1.04, overallRating: 81 },
        { name: 'Deportivo Alavés', shortName: 'ALA', slug: 'alaves', stadiumName: 'Mendizorrotza', attackStrength: 0.89, defenseStrength: 0.93, overallRating: 74 },
        { name: 'RCD Espanyol', shortName: 'ESP', slug: 'espanyol', stadiumName: 'RCDE Stadium', attackStrength: 0.86, defenseStrength: 0.85, overallRating: 73 },
      ],
    },
    'serie-a': {
      leagueName: 'Serie A',
      slug: 'serie-a',
      country: 'Italy',
      provenance: {
        source: 'Lega Serie A Official Clubs & Promotion/Relegation Data',
        sourceUrl: 'https://www.legaseriea.it/en/serie-a/clubs',
        retrievedAt: '2026-09-29',
        season: '2026-2027',
        attributeSource: 'SIM_SOCCER_MODEL_ESTIMATE',
      },
      teams: [
        { name: 'Atalanta', shortName: 'ATA', slug: 'atalanta', stadiumName: 'Gewiss Stadium', attackStrength: 1.24, defenseStrength: 1.10, overallRating: 83 },
        { name: 'Bologna', shortName: 'BOL', slug: 'bologna', stadiumName: "Stadio Renato Dall'Ara", attackStrength: 1.10, defenseStrength: 1.12, overallRating: 80 },
        { name: 'Cagliari', shortName: 'CAG', slug: 'cagliari', stadiumName: 'Unipol Domus', attackStrength: 0.88, defenseStrength: 0.89, overallRating: 74 },
        { name: 'Como', shortName: 'COM', slug: 'como', stadiumName: 'Stadio Giuseppe Sinigaglia', attackStrength: 0.90, defenseStrength: 0.87, overallRating: 74 },
        { name: 'Fiorentina', shortName: 'FIO', slug: 'fiorentina', stadiumName: 'Stadio Artemio Franchi', attackStrength: 1.10, defenseStrength: 1.04, overallRating: 79 },
        { name: 'Genoa', shortName: 'GEN', slug: 'genoa', stadiumName: 'Stadio Luigi Ferraris', attackStrength: 0.92, defenseStrength: 0.96, overallRating: 76 },
        { name: 'Hellas Verona', shortName: 'VER', slug: 'hellas-verona', stadiumName: 'Stadio Marcantonio Bentegodi', attackStrength: 0.86, defenseStrength: 0.89, overallRating: 74 },
        { name: 'Inter Milan', shortName: 'INT', slug: 'inter-milan', stadiumName: 'San Siro', attackStrength: 1.36, defenseStrength: 1.32, overallRating: 89 },
        { name: 'Juventus', shortName: 'JUV', slug: 'juventus', stadiumName: 'Allianz Stadium', attackStrength: 1.22, defenseStrength: 1.26, overallRating: 86 },
        { name: 'Lazio', shortName: 'LAZ', slug: 'lazio', stadiumName: 'Stadio Olimpico', attackStrength: 1.14, defenseStrength: 1.10, overallRating: 81 },
        { name: 'Lecce', shortName: 'LEC', slug: 'lecce', stadiumName: 'Stadio Via del Mare', attackStrength: 0.84, defenseStrength: 0.87, overallRating: 73 },
        { name: 'AC Milan', shortName: 'MIL', slug: 'ac-milan', stadiumName: 'San Siro', attackStrength: 1.26, defenseStrength: 1.20, overallRating: 85 },
        { name: 'Napoli', shortName: 'NAP', slug: 'napoli', stadiumName: 'Stadio Diego Armando Maradona', attackStrength: 1.28, defenseStrength: 1.22, overallRating: 86 },
        { name: 'Parma', shortName: 'PAR', slug: 'parma', stadiumName: 'Stadio Ennio Tardini', attackStrength: 0.90, defenseStrength: 0.88, overallRating: 74 },
        { name: 'Pisa', shortName: 'PSA', slug: 'pisa', stadiumName: 'Stadio Arena Garibaldi', attackStrength: 0.83, defenseStrength: 0.83, overallRating: 72 },
        { name: 'AS Roma', shortName: 'ROM', slug: 'as-roma', stadiumName: 'Stadio Olimpico', attackStrength: 1.16, defenseStrength: 1.12, overallRating: 82 },
        { name: 'Sassuolo', shortName: 'SAS', slug: 'sassuolo', stadiumName: 'Mapei Stadium', attackStrength: 0.89, defenseStrength: 0.86, overallRating: 74 },
        { name: 'Torino', shortName: 'TOR', slug: 'torino', stadiumName: 'Stadio Olimpico Grande Torino', attackStrength: 0.95, defenseStrength: 1.03, overallRating: 77 },
        { name: 'Udinese', shortName: 'UDI', slug: 'udinese', stadiumName: 'Bluenergy Stadium', attackStrength: 0.93, defenseStrength: 0.95, overallRating: 75 },
        { name: 'Empoli', shortName: 'EMP', slug: 'empoli', stadiumName: 'Stadio Carlo Castellani', attackStrength: 0.85, defenseStrength: 0.88, overallRating: 73 },
      ],
    },
  },
};
