"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [roomName, setRoomName] = useState("");
  const router = useRouter();

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomName.trim()) {
      router.push(`/room/${roomName}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-zinc-950 text-white">
      <div className="z-10 max-w-5xl w-full items-center justify-center font-mono text-sm lg:flex flex-col gap-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Meet Pro v2
        </h1>

        <form onSubmit={joinRoom} className="flex flex-col gap-4 w-full max-w-md">
          <input
            type="text"
            placeholder="Enter Room Name (e.g., daily-standup)"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="p-4 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-blue-500 outline-none transition-all"
          />
          <button
            type="submit"
            className="p-4 rounded-lg bg-blue-600 hover:bg-blue-700 font-bold transition-all"
          >
            Join Room
          </button>
        </form>

        <div className="text-zinc-500 text-center max-w-md">
          <p>Powered by Next.js, LiveKit & Node.js</p>
          <p className="text-xs mt-2">Includes High-Fidelity Podcast Recording</p>
        </div>
      </div>
    </main>
  );
}
