import { useState, useRef, useCallback } from 'react';

export const usePodcastRecording = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false, // OFF for podcast quality
                    sampleRate: 48000,
                    channelCount: 1,
                },
                video: false,
            });

            const options = { mimeType: 'audio/webm;codecs=opus' };
            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const url = URL.createObjectURL(audioBlob);
                setAudioUrl(url);

                // Auto-download for MVP
                const a = document.createElement('a');
                a.href = url;
                a.download = `podcast-recording-${new Date().toISOString()}.webm`;
                a.click();
            };

            mediaRecorder.start(1000);
            setIsRecording(true);
        } catch (err) {
            console.error('Error starting podcast recording:', err);
            alert('Could not start high-fidelity recording. Check microphone permissions.');
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
            setIsRecording(false);
        }
    }, []);

    return { isRecording, startRecording, stopRecording, audioUrl };
};
