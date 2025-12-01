# Walkthrough - Meet Pro App

## Overview
This document guides you through the "Meet Pro" application, a premium video conferencing tool with real-time features.

## Project Structure
- **server.js**: Main entry point. Handles HTTP requests and Socket.io signaling.
- **public/**: Contains all frontend assets.
    - **index.html**: Login page.
    - **room.html**: Main conference room.
    - **styles.css / login.css**: Premium styling.
    - **client.js**: WebRTC and Socket.io client logic.
    - **live-ticker.js**: Real-time crypto ticker.

## How to Run
1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Start Server**:
    ```bash
    npm start
    ```
3.  **Access Application**:
    - Open `http://localhost:3000` in your browser.

## Features Verification

### 1. Login
- Enter your name.
- Enter a Room ID (e.g., "room1") or click "Start New Meeting".
- Click "Join Meeting".

### 2. Video Conferencing
- **Permissions**: Allow camera and microphone access.
- **Multi-User**: Open the same URL in a new tab (or incognito window) to simulate a second user.
- **Verification**: You should see two video feeds (Local and Remote).

### 3. Controls
- **Mute/Video**: Toggle the microphone and camera buttons. Verify icons change and streams update.
- **Screen Share**: Click the desktop icon. Select a window to share. Verify the other user sees your screen.
- **Chat**: Click the chat icon. Type a message. Verify it appears for all users.

### 4. Whiteboard
- Click the pen icon.
- Draw on the canvas.
- Verify the drawing appears in real-time on the other user's screen.

### 5. Live Ticker
- Observe the top bar. It should display real-time crypto prices (Bitcoin, Ethereum, etc.).

## Deployment
- The project includes `nixpacks.toml` for easy deployment on platforms like Railway.
