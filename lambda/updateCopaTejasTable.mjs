/**
 * updateCopaTejasTable — AWS Lambda (nodejs20.x, handler `index.handler`).
 *
 * Rebuilds every Copa Tejas head-to-head table from API-Football and writes the
 * standings plus the season schedule to the Copa_Tejas_Table DynamoDB table.
 * One competition per league: MLS (Austin, Dallas, Houston) and USL Championship
 * (El Paso, San Antonio). Adding a league is a new entry in COMPETITIONS.
 *
 * Triggered by one-off EventBridge rules the night after each Copa match, so it
 * runs a handful of times a season. API-Football's free plan allows 100 requests
 * a day; a full run uses (teams − 1) requests per competition, three today.
 *
 * Event options (all optional):
 *   { "competitions": ["uslc"] }  run a subset of mls, uslc, shield (default: all)
 *   { "dryRun": true }            compute and return, write nothing
 *
 * "shield" is the cross-league Copa Tejas Shield (see SHIELD below); it reads the
 * American Soccer Analysis feed, not API-Football, and is refreshed on a schedule
 * because any Texas club's result can move it.
 *
 * Environment:
 *   RAPIDAPI_KEY   API-Football key on RapidAPI (required; never commit it)
 *   SEASON         API-Football season year (default: current UTC year)
 *
 * No bundled dependencies: uses global fetch and the AWS SDK v3 that ships with
 * the runtime, so the deploy artifact is this one file zipped.
 */

const TABLE_NAME = "Copa_Tejas_Table";
const API_HOST = "api-football-v1.p.rapidapi.com";
const LOGO_URL = (teamId) => `https://media.api-sports.io/football/teams/${teamId}.png`;

/**
 * Storage layout, kept backward compatible with the original MLS-only table:
 * MLS rows are keyed by bare team name and its schedule by "__fixtures__";
 * every other competition prefixes its keys so one Scan can serve them all.
 */
const COMPETITIONS = {
  mls: {
    id: "mls",
    leagueName: "Major League Soccer",
    // API-Football round labels that are league play (not playoffs).
    regularSeasonRound: /regular season/i,
    teams: { 1600: "Houston Dynamo", 1597: "FC Dallas", 16489: "Austin FC" },
    keyPrefix: "",
    fixturesKey: "__fixtures__",
  },
  uslc: {
    id: "uslc",
    leagueName: "USL Championship",
    // API-Football files USL Championship conference play as "Group Stage".
    regularSeasonRound: /group stage|regular season/i,
    teams: { 3993: "El Paso Locomotive", 4017: "San Antonio FC" },
    keyPrefix: "uslc#",
    fixturesKey: "__fixtures__uslc",
  },
};

/**
 * Copa Tejas Shield: every professional club in Texas, men's and women's, across
 * every league, ranked by points per game in league play. Results come from the
 * American Soccer Analysis feed (free, keyless, covers all six leagues; API-Football
 * would cost a request per club per run). Clubs are keyed by ASA's opaque team_id
 * because two Houston clubs share the abbreviation "HOU". Logos reuse API-Football's
 * team images so the table matches the other pages.
 */
const ASA_ROOT = "https://app.americansocceranalysis.com/api/v1";
const ASA_USER_AGENT = "copa-tejas/1.0 (+https://github.com/derekensign/copa-tejas; derekensign@gmail.com)";
const SHIELD = {
  id: "shield",
  keyPrefix: "shield#",
  leagues: {
    mls: { shortName: "MLS", name: "Major League Soccer" },
    nwsl: { shortName: "NWSL", name: "National Women's Soccer League" },
    uslc: { shortName: "USLC", name: "USL Championship" },
    usls: { shortName: "USLS", name: "USL Super League" },
    usl1: { shortName: "USL1", name: "USL League One" },
  },
  // Rio Grande Valley FC (uslc) and Texoma FC (usl1) have no 2026 league games in the
  // feed; add them back here with their API-Football logo id if they return.
  clubs: [
    { id: "ATX", asaTeamId: "gpMOLwl5zy", name: "Austin FC", league: "mls", logo: LOGO_URL(16489) },
    { id: "DAL", asaTeamId: "mKAqBBmqbg", name: "FC Dallas", league: "mls", logo: LOGO_URL(1597) },
    { id: "HOU", asaTeamId: "YgOMngl5wN", name: "Houston Dynamo", league: "mls", logo: LOGO_URL(1600) },
    { id: "DASH", asaTeamId: "4JMAk47qKg", name: "Houston Dash", league: "nwsl", logo: LOGO_URL(2998) },
    { id: "ELP", asaTeamId: "7VqGLwzQvW", name: "El Paso Locomotive", league: "uslc", logo: LOGO_URL(3993) },
    { id: "SA", asaTeamId: "7vQ7x3YMD1", name: "San Antonio FC", league: "uslc", logo: LOGO_URL(4017) },
    { id: "DTFC", asaTeamId: "2vQ1y44QrA", name: "Dallas Trinity FC", league: "usls", logo: LOGO_URL(24660) },
    { id: "CRP", asaTeamId: "e7MzzaKMr0", name: "Corpus Christi FC", league: "usl1", logo: LOGO_URL(4043) },
  ],
};

/** Statuses that mean a result exists. Live matches are deliberately excluded. */
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * All of one team's fixtures for the season, with retries on rate limiting.
 * @param {number} teamId
 * @param {string} season
 * @returns {Promise<object[]>} raw API-Football fixture objects
 */
async function fetchTeamFixtures(teamId, season) {
  // RAPIDAPI_FOOTBALL_KEY is the name the function used before September 2026.
  const apiKey = process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_FOOTBALL_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY is not set");
  const url = new URL(`https://${API_HOST}/v3/fixtures`);
  url.searchParams.set("season", season);
  url.searchParams.set("team", String(teamId));

  const MAX_ATTEMPTS = 3;
  let lastFailure;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": API_HOST },
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const backoffMs = 1500 * attempt;
        console.log(`Rate limited fetching team ${teamId}; backing off ${backoffMs}ms`);
        await sleep(backoffMs);
        continue;
      }
      if (!response.ok) throw new Error(`API-Football HTTP ${response.status} for team ${teamId}`);
      const data = await response.json();
      if (data.errors && Object.keys(data.errors).length) {
        throw new Error(`API-Football error for team ${teamId}: ${JSON.stringify(data.errors)}`);
      }
      console.log(`Fetched ${data.response?.length ?? 0} fixtures for team ${teamId} (requests left today: ${response.headers.get("x-ratelimit-requests-remaining")})`);
      return data.response || [];
    } catch (failure) {
      lastFailure = failure;
      if (attempt < MAX_ATTEMPTS) await sleep(1000 * attempt);
    }
  }
  throw lastFailure;
}

/**
 * Every regular-season league fixture between two Copa clubs, deduplicated.
 * Fetching each club except the last covers every pair.
 * @param {object} competition
 * @param {string} season
 */
async function fetchCopaFixtures(competition, season) {
  const teamIds = Object.keys(competition.teams).map(Number);
  const isCopaFixture = (fx) =>
    fx?.league?.name === competition.leagueName &&
    String(fx?.league?.season || "") === String(season) &&
    competition.regularSeasonRound.test(fx?.league?.round || "") &&
    teamIds.includes(fx?.teams?.home?.id) &&
    teamIds.includes(fx?.teams?.away?.id);

  const byFixtureId = new Map();
  for (let i = 0; i < teamIds.length - 1; i++) {
    const fixtures = await fetchTeamFixtures(teamIds[i], season);
    for (const fx of fixtures) if (isCopaFixture(fx)) byFixtureId.set(fx.fixture.id, fx);
    if (i < teamIds.length - 2) await sleep(1200);
  }
  return [...byFixtureId.values()].sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
}

class Team {
  constructor(name, logo) {
    this.name = name;
    this.logo = logo;
    this.points = 0;
    this.goalsFor = 0;
    this.goalsAgainst = 0;
    this.goalDifference = 0;
    this.gamesPlayed = 0;
    this.directMatches = {}; // opponent name -> {points, goalsFor, goalsAgainst, goalDifference}
  }

  record(opponentName, goalsFor, goalsAgainst) {
    const points = goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
    this.gamesPlayed += 1;
    this.goalsFor += goalsFor;
    this.goalsAgainst += goalsAgainst;
    this.goalDifference = this.goalsFor - this.goalsAgainst;
    this.points += points;
    const direct = (this.directMatches[opponentName] ||= { points: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0 });
    direct.points += points;
    direct.goalsFor += goalsFor;
    direct.goalsAgainst += goalsAgainst;
    direct.goalDifference = direct.goalsFor - direct.goalsAgainst;
  }

  get pointsPerGame() {
    return this.gamesPlayed > 0 ? (this.points / this.gamesPlayed).toFixed(2) : "0.00";
  }
}

/**
 * Official Copa Tejas order: points per game, then head-to-head points, goal
 * difference and goals scored between the two clubs, then overall goal
 * difference and goals scored.
 */
function sortTeams(teams) {
  return Object.values(teams).sort((a, b) => {
    const ppgA = a.gamesPlayed ? a.points / a.gamesPlayed : 0;
    const ppgB = b.gamesPlayed ? b.points / b.gamesPlayed : 0;
    if (ppgB !== ppgA) return ppgB - ppgA;
    const directA = a.directMatches[b.name] || { points: 0, goalDifference: 0, goalsFor: 0 };
    const directB = b.directMatches[a.name] || { points: 0, goalDifference: 0, goalsFor: 0 };
    return (
      directB.points - directA.points ||
      directB.goalDifference - directA.goalDifference ||
      directB.goalsFor - directA.goalsFor ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name)
    );
  });
}

/**
 * Compute one competition's standings and schedule.
 * @param {object} competition entry of COMPETITIONS
 * @param {string} season
 */
async function buildCompetition(competition, season) {
  const fixtures = await fetchCopaFixtures(competition, season);
  const nameOf = (team) => competition.teams[team.id] ?? team.name;

  // Every club is always present, even on zero games, so the table never loses a row.
  const teams = {};
  for (const [id, name] of Object.entries(competition.teams)) teams[name] = new Team(name, LOGO_URL(id));

  for (const fx of fixtures) {
    if (!FINISHED_STATUSES.has(fx.fixture.status.short)) continue;
    if (fx.goals.home === null || fx.goals.away === null) continue;
    const home = nameOf(fx.teams.home);
    const away = nameOf(fx.teams.away);
    teams[home].record(away, fx.goals.home, fx.goals.away);
    teams[away].record(home, fx.goals.away, fx.goals.home);
  }

  const standings = sortTeams(teams);
  const schedule = fixtures.map((fx) => ({
    fixtureId: fx.fixture.id,
    date: fx.fixture.date,
    status: fx.fixture.status.short,
    homeTeam: nameOf(fx.teams.home),
    homeLogo: fx.teams.home.logo,
    awayTeam: nameOf(fx.teams.away),
    awayLogo: fx.teams.away.logo,
    homeGoals: fx.goals.home,
    awayGoals: fx.goals.away,
  }));
  return { standings, schedule };
}

// ---------------------------------------------------------------------------
// Shield (ASA)
// ---------------------------------------------------------------------------

/** @param {string} path e.g. "/games?season_name=2026" @param {string} league ASA slug */
async function fetchAsaJson(path, league) {
  const url = `${ASA_ROOT}/${league}${path}`;
  let lastFailure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": ASA_USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(40000),
      });
      if (!response.ok) throw new Error(`ASA ${league}${path} HTTP ${response.status}`);
      return await response.json();
    } catch (failure) {
      lastFailure = failure;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastFailure;
}

/** Completed league (not cup/playoff) game with a score. */
const isCompletedLeagueGame = (game) =>
  !game.knockout_game && game.home_score !== null && game.home_score !== undefined &&
  game.away_score !== null && game.away_score !== undefined;

/**
 * A league's current season is the one holding its most recent completed game.
 * Leagues differ: MLS/NWSL/USL men's are calendar-year; the USL Super League runs
 * autumn to spring and ASA has labelled it both "2025-26" and "2026".
 */
async function fetchCurrentSeasonGames(league, year) {
  const candidates = [String(year), `${year - 1}-${String(year).slice(2)}`, `${year}-${String(year + 1).slice(2)}`];
  let best = null;
  for (const seasonName of candidates) {
    const games = await fetchAsaJson(`/games?season_name=${encodeURIComponent(seasonName)}`, league);
    const completed = Array.isArray(games) ? games.filter(isCompletedLeagueGame) : [];
    if (!completed.length) continue;
    const latest = completed.reduce((max, g) => (g.date_time_utc > max ? g.date_time_utc : max), "");
    if (!best || latest > best.latest) best = { seasonName, games, latest };
  }
  if (best) return best;
  const all = (await fetchAsaJson("/games", league)) || [];
  const completed = all.filter(isCompletedLeagueGame);
  if (!completed.length) throw new Error(`ASA ${league}: no completed games`);
  const latestGame = completed.reduce((max, g) => (g.date_time_utc > max.date_time_utc ? g : max));
  const seasonName = String(latestGame.season_name);
  return { seasonName, games: all.filter((g) => String(g.season_name) === seasonName), latest: latestGame.date_time_utc };
}

/** One club's league record from its league's completed games. */
function shieldRecord(club, games) {
  const record = { gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  for (const game of games) {
    if (!isCompletedLeagueGame(game)) continue;
    const home = game.home_team_id === club.asaTeamId;
    const away = game.away_team_id === club.asaTeamId;
    if (!home && !away) continue;
    const scored = Number(home ? game.home_score : game.away_score);
    const conceded = Number(home ? game.away_score : game.home_score);
    record.gp += 1;
    record.gf += scored;
    record.ga += conceded;
    if (scored > conceded) { record.w += 1; record.pts += 3; }
    else if (scored === conceded) { record.d += 1; record.pts += 1; }
    else record.l += 1;
  }
  return record;
}

/**
 * Build the Shield table: PPG, then goal difference per game, then goals for per
 * game, then name. Clubs without a completed league game this season are omitted.
 */
async function buildShield(year) {
  const leagueSlugs = Object.keys(SHIELD.leagues);
  const seasons = Object.fromEntries(
    await Promise.all(leagueSlugs.map(async (league) => [league, await fetchCurrentSeasonGames(league, year)]))
  );
  const rows = [];
  for (const club of SHIELD.clubs) {
    const { seasonName, games } = seasons[club.league];
    const record = shieldRecord(club, games);
    if (record.gp === 0) continue;
    rows.push({
      ...club,
      season: seasonName,
      ...record,
      gd: record.gf - record.ga,
      ppg: record.pts / record.gp,
      gdPerGame: (record.gf - record.ga) / record.gp,
      gfPerGame: record.gf / record.gp,
    });
  }
  rows.sort((a, b) => b.ppg - a.ppg || b.gdPerGame - a.gdPerGame || b.gfPerGame - a.gfPerGame || a.name.localeCompare(b.name));
  if (!rows.length) throw new Error("Shield: no Texas club has a completed league game");
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Write Shield rows, then remove any Shield row for a club no longer in the table. */
async function writeShield(rows) {
  const { DynamoDBClient, PutItemCommand, ScanCommand, DeleteItemCommand } = await import("@aws-sdk/client-dynamodb");
  const client = new DynamoDBClient({ region: "us-east-1" });
  const written = new Set();
  for (const row of rows) {
    const key = SHIELD.keyPrefix + row.id;
    written.add(key);
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        TeamName: { S: key },
        DisplayName: { S: row.name },
        Competition: { S: SHIELD.id },
        Rank: { N: String(row.rank) },
        League: { S: SHIELD.leagues[row.league].shortName },
        LeagueName: { S: SHIELD.leagues[row.league].name },
        Season: { S: row.season },
        Logo: { S: row.logo },
        GamesPlayed: { N: String(row.gp) },
        Wins: { N: String(row.w) },
        Draws: { N: String(row.d) },
        Losses: { N: String(row.l) },
        GoalsFor: { N: String(row.gf) },
        GoalsAgainst: { N: String(row.ga) },
        GoalDifference: { N: String(row.gd) },
        Points: { N: String(row.pts) },
        PointsPerGame: { N: row.ppg.toFixed(2) },
      },
    }));
  }
  const existing = await client.send(new ScanCommand({
    TableName: TABLE_NAME,
    ProjectionExpression: "TeamName",
    FilterExpression: "Competition = :c",
    ExpressionAttributeValues: { ":c": { S: SHIELD.id } },
  }));
  for (const item of existing.Items || []) {
    if (!written.has(item.TeamName.S)) {
      await client.send(new DeleteItemCommand({ TableName: TABLE_NAME, Key: { TeamName: item.TeamName } }));
    }
  }
}

/** Write one competition to DynamoDB. The SDK is imported lazily so dry runs need no SDK. */
async function writeCompetition(competition, standings, schedule) {
  const { DynamoDBClient, PutItemCommand } = await import("@aws-sdk/client-dynamodb");
  const client = new DynamoDBClient({ region: "us-east-1" });
  // Rank is stored because a Scan returns rows in arbitrary order and the
  // tiebreakers cannot be recomputed from the row alone.
  for (const [index, team] of standings.entries()) {
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        TeamName: { S: competition.keyPrefix + team.name },
        DisplayName: { S: team.name },
        Competition: { S: competition.id },
        Rank: { N: String(index + 1) },
        Logo: { S: team.logo },
        Points: { N: String(team.points) },
        GoalsFor: { N: String(team.goalsFor) },
        GoalsAgainst: { N: String(team.goalsAgainst) },
        GoalDifference: { N: String(team.goalDifference) },
        GamesPlayed: { N: String(team.gamesPlayed) },
        PointsPerGame: { N: team.pointsPerGame },
      },
    }));
  }
  await client.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      TeamName: { S: competition.fixturesKey },
      Competition: { S: competition.id },
      FixturesJSON: { S: JSON.stringify(schedule) },
    },
  }));
}

export const handler = async (event = {}) => {
  const season = process.env.SEASON || String(new Date().getUTCFullYear());
  const requested = event.competitions
    ? [].concat(event.competitions).map((id) => String(id).toLowerCase())
    : [...Object.keys(COMPETITIONS), SHIELD.id];
  const unknown = requested.filter((id) => !COMPETITIONS[id] && id !== SHIELD.id);
  if (unknown.length) return { statusCode: 400, body: JSON.stringify({ error: `Unknown competition(s): ${unknown.join(", ")}` }) };

  const output = {};
  try {
    for (const id of requested) {
      if (id === SHIELD.id) {
        const rows = await buildShield(Number(season));
        console.log(`shield: ${rows.map((r) => `${r.rank}. ${r.name} ${r.ppg.toFixed(2)}`).join(" | ")}`);
        if (!event.dryRun) await writeShield(rows);
        output.shield = {
          standings: rows.map(({ asaTeamId, gdPerGame, gfPerGame, ...row }) => ({ ...row, ppg: row.ppg.toFixed(2) })),
        };
        continue;
      }
      const competition = COMPETITIONS[id];
      const { standings, schedule } = await buildCompetition(competition, season);
      console.log(`${id}: ${schedule.length} fixtures, standings ${standings.map((t) => `${t.name} ${t.pointsPerGame}`).join(" | ")}`);
      if (!event.dryRun) await writeCompetition(competition, standings, schedule);
      output[id] = {
        standings: standings.map((t) => ({
          name: t.name, logo: t.logo, points: t.points, goalsFor: t.goalsFor, goalsAgainst: t.goalsAgainst,
          goalDifference: t.goalDifference, gamesPlayed: t.gamesPlayed, pointsPerGame: t.pointsPerGame,
        })),
        fixtures: schedule,
      };
    }
    return { statusCode: 200, body: JSON.stringify({ season, dryRun: Boolean(event.dryRun), competitions: output }) };
  } catch (error) {
    console.error("Error processing fixtures:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Error processing fixtures", detail: error.message }) };
  }
};
