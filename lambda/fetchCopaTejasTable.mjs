/**
 * fetchCopaTejasTable — AWS Lambda (nodejs20.x, handler `index.handler`) behind
 * API Gateway `ANY /fetchCopaTejasTable` on the copa-tejas HTTP API.
 *
 *   GET /fetchCopaTejasTable                    MLS table (default, unchanged URL)
 *   GET /fetchCopaTejasTable?competition=uslc   USL Championship table
 *
 * Response: { standings: [...], fixtures: [...] } in the shape the React app expects.
 *
 * Storage layout (see updateCopaTejasTable.mjs): MLS rows are keyed by bare
 * team name with schedule under "__fixtures__"; other competitions prefix their
 * keys ("uslc#…", "__fixtures__uslc") and carry a Competition attribute. Legacy
 * MLS rows written before the attribute existed have none, so "no attribute"
 * reads as MLS.
 */

import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = "Copa_Tejas_Table";
const DEFAULT_COMPETITION = "mls";
const FIXTURES_KEY_PREFIX = "__fixtures__";

const docClient = DynamoDBDocumentClient.from(new DynamoDB({}));

const jsonResponse = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  },
});

export const handler = async (event) => {
  const competition = String(event?.queryStringParameters?.competition || DEFAULT_COMPETITION).toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(competition)) return jsonResponse(400, { message: "Invalid competition" });

  const isMls = competition === DEFAULT_COMPETITION;
  const keyPrefix = isMls ? "" : `${competition}#`;
  const fixturesKey = isMls ? FIXTURES_KEY_PREFIX : `${FIXTURES_KEY_PREFIX}${competition}`;
  const belongsToCompetition = (item) =>
    isMls ? !item.Competition || item.Competition === DEFAULT_COMPETITION : item.Competition === competition;

  try {
    const data = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
    const items = data.Items || [];

    const fixturesEntry = items.find((item) => item.TeamName === fixturesKey);
    const fixtures = fixturesEntry?.FixturesJSON ? JSON.parse(fixturesEntry.FixturesJSON) : [];

    // Official order when the updater stored a Rank; points per game otherwise
    // (rows written before Rank existed), which is what the app always did.
    const standings = items
      .filter((item) => !String(item.TeamName).startsWith(FIXTURES_KEY_PREFIX) && belongsToCompetition(item))
      .map(({ Competition, DisplayName, ...item }) => ({
        ...item,
        TeamName: DisplayName || String(item.TeamName).replace(keyPrefix, ""),
      }))
      .sort((a, b) => {
        if (a.Rank != null && b.Rank != null) return Number(a.Rank) - Number(b.Rank);
        return Number(b.PointsPerGame) - Number(a.PointsPerGame);
      });

    if (!isMls && standings.length === 0 && fixtures.length === 0) {
      return jsonResponse(404, { message: `No data for competition '${competition}'` });
    }
    return jsonResponse(200, { standings, fixtures });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, { message: "Internal Server Error" });
  }
};
