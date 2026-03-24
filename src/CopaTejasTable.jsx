import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

function StandingsRow({ row }) {
  return (
    <TableRow className="even:bg-gray-100 odd:bg-white">
      <TableCell className="p-4 border-b border-gray-300" component="th" scope="row">
        <div className="flex items-center min-w-25">
          <img src={row.Logo} alt={`${row.TeamName} Logo`} className="w-8 mr-4" />
          <span className="mr-6 sm:mr-0">{row.TeamName}</span>
        </div>
      </TableCell>
      <TableCell className="p-4 border-b border-gray-300 text-center">{row.GamesPlayed}</TableCell>
      <TableCell className="p-4 border-b border-gray-300 text-center">{row.Points}</TableCell>
      <TableCell className="p-4 border-b border-gray-300 text-center">{row.PointsPerGame}</TableCell>
      <TableCell className="p-4 border-b border-gray-300 text-center">{row.GoalsFor}</TableCell>
      <TableCell className="p-4 border-b border-gray-300 text-center">{row.GoalsAgainst}</TableCell>
      <TableCell className="p-4 border-b border-gray-300 text-center">{row.GoalDifference}</TableCell>
    </TableRow>
  );
}

function FixtureCard({ fixture }) {
  const gameDate = new Date(fixture.date);
  const isFinished = fixture.status === 'FT';
  const dateString = gameDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeString = gameDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className={`flex items-center p-2 sm:p-3 rounded-lg border ${isFinished ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}>
      {/* Home team */}
      <div className="flex items-center flex-1 justify-end min-w-0">
        <span className="text-xs sm:text-sm font-medium mr-2 sm:mr-3 text-right truncate">{fixture.homeTeam}</span>
        <img src={fixture.homeLogo} alt={fixture.homeTeam} className="w-6 h-6 sm:w-7 sm:h-7 object-contain flex-shrink-0" />
      </div>

      {/* Score or date */}
      <div className="mx-2 sm:mx-4 w-[90px] sm:w-[120px] flex-shrink-0 text-center">
        {isFinished ? (
          <div>
            <span className="text-base sm:text-lg font-bold">{fixture.homeGoals} - {fixture.awayGoals}</span>
            <div className="text-xs text-gray-500">FT</div>
          </div>
        ) : (
          <div>
            <div className="text-xs font-medium text-gray-700">{dateString}</div>
            <div className="text-xs text-gray-500">{timeString}</div>
          </div>
        )}
      </div>

      {/* Away team */}
      <div className="flex items-center flex-1 min-w-0">
        <img src={fixture.awayLogo} alt={fixture.awayTeam} className="w-6 h-6 sm:w-7 sm:h-7 object-contain flex-shrink-0" />
        <span className="text-xs sm:text-sm font-medium ml-2 sm:ml-3 truncate">{fixture.awayTeam}</span>
      </div>
    </div>
  );
}

export default function CopaTejasTable() {
  const [rows, setRows] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeData = async () => {
      setIsLoading(true);
      const data = await fetchCopaTejasTable();

      // Handle both old format (array) and new format ({ standings, fixtures })
      if (Array.isArray(data)) {
        data.sort((a, b) => b.PointsPerGame - a.PointsPerGame);
        setRows(data);
      } else {
        const standings = data.standings || [];
        standings.sort((a, b) => b.PointsPerGame - a.PointsPerGame);
        setRows(standings);
        setFixtures(data.fixtures || []);
      }

      setIsLoading(false);
    };
    initializeData();
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {isLoading ? (
        <div className="flex justify-center items-center h-screen">
          <CircularProgress />
        </div>
      ) : (
        <div>
          {/* Standings Table */}
          <TableContainer component={Paper} className="overflow-hidden rounded-lg shadow-lg">
            <Table className="min-w-full divide-y divide-gray-300">
              <TableHead className="bg-gray-300 text-white">
                <TableRow>
                  <TableCell className="p-4 text-left">Team</TableCell>
                  <TableCell className="p-4 text-center">Games</TableCell>
                  <TableCell className="p-4 text-center">Points</TableCell>
                  <TableCell className="p-4 text-center">PPG</TableCell>
                  <TableCell className="p-4 text-center">GF</TableCell>
                  <TableCell className="p-4 text-center">GA</TableCell>
                  <TableCell className="p-4 text-center">GD</TableCell>
                </TableRow>
              </TableHead>
              <TableBody className="bg-white divide-y divide-gray-300">
                {rows.map((row, index) => (
                  <StandingsRow key={index} row={row} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Fixtures Schedule */}
          {fixtures.length > 0 && (
            <div className="mt-4 px-4 py-3 bg-white shadow-md rounded-lg">
              <h3 className="mb-3 font-semibold text-lg text-gray-900">2026 Schedule & Results</h3>
              <div className="flex flex-col gap-2">
                {fixtures.map((fixture) => (
                  <FixtureCard key={fixture.fixtureId} fixture={fixture} />
                ))}
              </div>
            </div>
          )}

          {/* Collapsible Rules & Tiebreakers */}
          <div className="mt-4">
            <Accordion defaultExpanded={false} sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                className="bg-white"
                sx={{ minHeight: 48, '& .MuiAccordionSummary-content': { margin: '8px 0' } }}
              >
                <span className="font-semibold text-lg text-gray-900">Rules & Tiebreakers</span>
              </AccordionSummary>
              <AccordionDetails className="bg-white">
                <p className="text-sm md:text-base text-gray-800">
                  To compensate for the variations in number of Copa Tejas matches played per team
                  (due to league scheduling), the teams will be ranked by the average number of
                  points per Copa Tejas match (PPG).
                </p>
                <h4 className="mt-4 mb-2 font-semibold text-base md:text-lg text-gray-900">Tiebreakers:</h4>
                <ol className="list-decimal pl-5 space-y-1 text-gray-800">
                  <li>Greater number of points earned in matches between the teams concerned</li>
                  <li>Greater goal difference in matches between the teams concerned</li>
                  <li>Greater number of goals scored in matches between the teams concerned</li>
                  <li>Reapply first three criteria if two or more teams are still tied</li>
                  <li>Greater goal difference in all cup matches</li>
                  <li>Greater number of goals scored in all cup matches</li>
                  <li>Smaller number of disciplinary points in all cup matches (yellow = 1 point, red = 2 points)</li>
                </ol>
              </AccordionDetails>
            </Accordion>
          </div>
        </div>
      )}
    </div>
  );
}

async function fetchCopaTejasTable() {
  try {
    const response = await axios.get('https://0n685go0ul.execute-api.us-east-1.amazonaws.com/fetchCopaTejasTable');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch data:', error);
    return [];
  }
}
