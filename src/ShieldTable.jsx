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
} from '@mui/material';

/**
 * Copa Tejas Shield: every professional club in Texas, men's and women's, across
 * MLS, NWSL, USL Championship, USL Super League and USL League One, ranked by
 * points per game in league play. Just the table; the holder is decided at
 * season's end, so nothing here names one.
 */

const API_URL = 'https://0n685go0ul.execute-api.us-east-1.amazonaws.com/fetchCopaTejasTable';

const headerCell = 'p-4 text-center';
const cell = 'p-4 border-b border-gray-300 text-center';
// GF and GA drop out on phones so the columns that decide the table stay visible.
const optional = ' hidden sm:table-cell';

function ShieldRow({ row }) {
  return (
    <TableRow className="even:bg-gray-100 odd:bg-white">
      <TableCell className="p-4 border-b border-gray-300 text-center text-gray-500">{row.Rank}</TableCell>
      <TableCell className="p-4 border-b border-gray-300" component="th" scope="row">
        <div className="flex items-center min-w-25">
          {row.Logo && <img src={row.Logo} alt={`${row.TeamName} Logo`} className="w-8 mr-4" />}
          <span className="mr-6 sm:mr-0">{row.TeamName}</span>
        </div>
      </TableCell>
      <TableCell className={cell} title={row.LeagueName}>{row.League}</TableCell>
      <TableCell className={cell}>{row.GamesPlayed}</TableCell>
      <TableCell className={cell}>{row.Wins}-{row.Draws}-{row.Losses}</TableCell>
      <TableCell className={cell}>{row.Points}</TableCell>
      <TableCell className={cell + ' font-semibold'}>{Number(row.PointsPerGame).toFixed(2)}</TableCell>
      <TableCell className={cell + optional}>{row.GoalsFor}</TableCell>
      <TableCell className={cell + optional}>{row.GoalsAgainst}</TableCell>
      <TableCell className={cell}>{row.GoalDifference > 0 ? `+${row.GoalDifference}` : row.GoalDifference}</TableCell>
    </TableRow>
  );
}

export default function ShieldTable() {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeData = async () => {
      setIsLoading(true);
      const standings = await fetchShield();
      standings.sort((a, b) =>
        a.Rank != null && b.Rank != null ? a.Rank - b.Rank : b.PointsPerGame - a.PointsPerGame
      );
      setRows(standings);
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
        <TableContainer component={Paper} className="overflow-hidden rounded-lg shadow-lg">
          <Table className="min-w-full divide-y divide-gray-300">
            <TableHead className="bg-gray-300 text-white">
              <TableRow>
                <TableCell className={headerCell}>#</TableCell>
                <TableCell className="p-4 text-left">Team</TableCell>
                <TableCell className={headerCell}>League</TableCell>
                <TableCell className={headerCell}>Games</TableCell>
                <TableCell className={headerCell}>W-D-L</TableCell>
                <TableCell className={headerCell}>Points</TableCell>
                <TableCell className={headerCell}>PPG</TableCell>
                <TableCell className={headerCell + optional}>GF</TableCell>
                <TableCell className={headerCell + optional}>GA</TableCell>
                <TableCell className={headerCell}>GD</TableCell>
              </TableRow>
            </TableHead>
            <TableBody className="bg-white divide-y divide-gray-300">
              {rows.map((row) => (
                <ShieldRow key={row.TeamName} row={row} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}

async function fetchShield() {
  try {
    const response = await axios.get(API_URL, { params: { competition: 'shield' } });
    return response.data.standings || [];
  } catch (error) {
    console.error('Failed to fetch Shield standings:', error);
    return [];
  }
}
