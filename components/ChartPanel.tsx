"use client";

import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const dummyData = [
  { time: '10:00', mq137: 240, mq136: 120, mq4: 300 },
  { time: '10:05', mq137: 255, mq136: 125, mq4: 310 },
  { time: '10:10', mq137: 270, mq136: 130, mq4: 305 },
  { time: '10:15', mq137: 260, mq136: 140, mq4: 320 },
  { time: '10:20', mq137: 280, mq136: 145, mq4: 340 },
  { time: '10:25', mq137: 310, mq136: 160, mq4: 360 },
  { time: '10:30', mq137: 340, mq136: 180, mq4: 390 },
];

export default function ChartPanel() {
  return (
    <div className="md:col-span-2 bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl flex flex-col shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-black text-white/90 uppercase tracking-wider drop-shadow-md">
          Pergerakan Gas Aktif
        </h2>
        <span className="flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-cyan-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
        </span>
      </div>
      
      <div className="flex-1 w-full min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dummyData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" vertical={false} />
            <XAxis dataKey="time" stroke="#ffffff70" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#ffffff70" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '12px' }}
              itemStyle={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}
            />
            <Line type="monotone" dataKey="mq137" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4, fill: '#38bdf8', strokeWidth: 0 }} activeDot={{ r: 6 }} name="MQ-137" />
            <Line type="monotone" dataKey="mq4" stroke="#a78bfa" strokeWidth={3} dot={{ r: 4, fill: '#a78bfa', strokeWidth: 0 }} activeDot={{ r: 6 }} name="MQ-4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}