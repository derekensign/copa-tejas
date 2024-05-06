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

function SimpleRow({ row }) {
  return  (
    <TableRow className="even:bg-gray-100 odd:bg-white">
      <TableCell className="p-4 border-b border-gray-300 " component="th" scope="row">
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

export default function CopaTejasTable() {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeData = async () => {
      setIsLoading(true);
      const data = await fetchCopaTejasTable();
      data.sort((a, b) => b.PointsPerGame - a.PointsPerGame);
      setRows(data);
      setIsLoading(false);
    };
    initializeData();
  }, []);

  return (
    <div className="min-h-screen bg-white">
    {isLoading ? <div className="flex justify-center items-center h-screen"><CircularProgress /></div>
    : (
    <div>
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
              <SimpleRow key={index} row={row} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <div class="mt-4 px-4 py-2 bg-white shadow-md">
        <p class="text-sm md:text-base text-gray-800">
            To compensate for the variations in number of Copa Tejas matches played per team (due to league scheduling), the teams will be ranked by the average number of points per Copa Tejas match (PPG).
        </p>
        <h3 class="mt-4 mb-2 font-semibold text-lg md:text-xl text-gray-900">Tiebreakers:</h3>
        <ol class="list-decimal pl-5 space-y-1 text-gray-800">
            <li>Greater number of points earned in matches between the teams concerned</li>
            <li>Greater goal difference in matches between the teams concerned</li>
            <li>Greater number of goals scored in matches between the teams concerned</li>
            <li>Reapply first three criteria if two or more teams are still tied</li>
            <li>Greater goal difference in all cup matches</li>
            <li>Greater number of goals scored in all cup matches</li>
            <li>Smaller number of disciplinary points in all cup matches (yellow = 1 point, red = 2 points)</li>
        </ol>
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
