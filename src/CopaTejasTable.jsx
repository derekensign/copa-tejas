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
    <div className="bg-gray-500 text-white p-4 flex items-center">
      <a href="http://www.copatejas.com" className="flex items-center">
        <img src="/CT-logo.png" alt="COPA TEJAS Logo" className="h-12 w-12 mr-2" />
        <span className="text-xl font-bold">COPA TEJAS</span>
      </a>
    </div>
    {isLoading && <div className="flex justify-center items-center h-screen"><CircularProgress /></div>}
    <TableContainer component={Paper} className="overflow-hidden p-0 sm:p-10 rounded-lg shadow-lg">
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
