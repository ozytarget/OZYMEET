# Meet Pro v2

Professional video conferencing application built with Next.js, Node.js, and LiveKit.

## Prerequisites

- Node.js 18+
- LiveKit Cloud Account (Credentials configured)

## Project Structure

- `/client`: Next.js Frontend (React, Tailwind, LiveKit SDK)
- `/server`: Node.js Backend (Express, Token Generation)

## Getting Started

You need to run both the client and the server terminals.

### 1. Start the Backend (API)

```bash
cd server
npm run dev
```
Runs on `http://localhost:3001`

### 2. Start the Frontend (Client)

```bash
cd client
npm run dev
```
Runs on `http://localhost:3000`

## Features

- **Video Conferencing**: Powered by LiveKit (SFU).
- **Podcast Recording**: Local high-fidelity audio recording (48kHz, no gain control) via `usePodcastRecording` hook.
- **Modern UI**: TailwindCSS + Glassmorphism.

## Environment Variables

**Server (`/server/.env`)**:
```
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_URL=...
PORT=3001
```

**Client (`/client/.env.local`)**:
```
NEXT_PUBLIC_LIVEKIT_URL=...
```
