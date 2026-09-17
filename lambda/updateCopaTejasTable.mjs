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
 *   { "competitions": ["uslc"] }  run a subset (default: all)
 *   { "dryRun": true }            compute and return, write nothing
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
    : Object.keys(COMPETITIONS);
  const unknown = requested.filter((id) => !COMPETITIONS[id]);
  if (unknown.length) return { statusCode: 400, body: JSON.stringify({ error: `Unknown competition(s): ${unknown.join(", ")}` }) };

  const output = {};
  try {
    for (const id of requested) {
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
