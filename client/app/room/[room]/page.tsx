"use client";

import {
    ControlBar,
    GridLayout,
    LiveKitRoom,
    ParticipantTile,
    RoomAudioRenderer,
    useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { useEffect, useState, use } from "react";
import { usePodcastRecording } from "@/hooks/usePodcastRecording";

export default function RoomPage({ params }: { params: Promise<{ room: string }> }) {
    const { room } = use(params);
    const [token, setToken] = useState("");
    const { isRecording, startRecording, stopRecording } = usePodcastRecording();

    useEffect(() => {
        (async () => {
            try {
                const resp = await fetch(
                    `http://localhost:3001/api/token`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ room, username: `User-${Math.floor(Math.random() * 1000)}` })
                    }
                );
                const data = await resp.json();
                setToken(data.token);
            } catch (e) {
                console.error(e);
            }
        })();
    }, [room]);

    if (token === "") {
        return <div className="flex items-center justify-center h-screen bg-zinc-900 text-white">Getting token...</div>;
    }

    return (
        <LiveKitRoom
            video={true}
            audio={true}
            token={token}
            serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
            data-lk-theme="default"
            style={{ height: "100vh" }}
        >
            <VideoConference />
            <RoomAudioRenderer />

            {/* Custom Podcast Controls Overlay */}
            <div className="absolute top-4 left-4 z-50">
                <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`px-4 py-2 rounded-full font-bold transition-all ${isRecording
                        ? "bg-red-500 hover:bg-red-600 animate-pulse"
                        : "bg-zinc-700 hover:bg-zinc-600"
                        } text-white flex items-center gap-2`}
                >
                    {isRecording ? (
                        <>
                            <div className="w-3 h-3 bg-white rounded-full" />
                            Stop Podcast Rec
                        </>
                    ) : (
                        <>
                            <div className="w-3 h-3 bg-red-500 rounded-full" />
                            Start Podcast Rec (Local)
                        </>
                    )}
                </button>
            </div>

            <ControlBar />
        </LiveKitRoom>
    );
}

function VideoConference() {
    const tracks = useTracks(
        [
            { source: Track.Source.Camera, withPlaceholder: true },
            { source: Track.Source.ScreenShare, withPlaceholder: false },
        ],
        { onlySubscribed: false },
    );

    return (
        <GridLayout tracks={tracks} style={{ height: "calc(100vh - var(--lk-control-bar-height))" }}>
            <ParticipantTile />
        </GridLayout>
    );
}
