"use client";

import { useEffect, useRef, useState } from "react";

type RecorderStatus = "idle" | "requesting" | "recording" | "error";

type UseAudioRecorderOptions = {
  chunkMs?: number;
  onChunk?: (blob: Blob) => void;
};

const MINIMUM_CHUNK_SIZE_BYTES = 1024;
const MINIMUM_CHUNK_DURATION_MS = 3_000;

export function useAudioRecorder({
  chunkMs = 30_000,
  onChunk,
}: UseAudioRecorderOptions = {}) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushResolversRef = useRef<Array<() => void>>([]);
  const shouldContinueRef = useRef(false);
  const segmentStartedAtRef = useRef<number | null>(null);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      shouldContinueRef.current = false;

      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
      }

      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function getPreferredMimeType() {
    if (typeof MediaRecorder === "undefined") {
      return undefined;
    }

    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      return "audio/webm;codecs=opus";
    }

    if (MediaRecorder.isTypeSupported("audio/webm")) {
      return "audio/webm";
    }

    return undefined;
  }

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    segmentStartedAtRef.current = null;

    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
  }

  function resolveFlushes() {
    flushResolversRef.current.splice(0).forEach((resolve) => resolve());
  }

  function stopSegment() {
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }

    resolveFlushes();
  }

  function startSegment() {
    const stream = streamRef.current;

    if (!stream) {
      cleanupStream();
      setStatus("idle");
      return;
    }

    const mimeType = getPreferredMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    const chunks: Blob[] = [];

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      shouldContinueRef.current = false;
      cleanupStream();
      resolveFlushes();
      setStatus("error");
      setError("Recording failed. Please try again.");
    };

    recorder.onstart = () => {
      segmentStartedAtRef.current = Date.now();
      setStatus("recording");

      segmentTimerRef.current = setTimeout(() => {
        stopSegment();
      }, chunkMs);
    };

    recorder.onstop = () => {
      const segmentStartedAt = segmentStartedAtRef.current ?? Date.now();
      const durationMs = Date.now() - segmentStartedAt;
      const type = recorder.mimeType || mimeType || "audio/webm";

      mediaRecorderRef.current = null;
      segmentStartedAtRef.current = null;
      resolveFlushes();

      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }

      const blob = new Blob(chunks, { type });
      const isValidChunk =
        blob.size >= MINIMUM_CHUNK_SIZE_BYTES &&
        durationMs >= MINIMUM_CHUNK_DURATION_MS;

      if (isValidChunk) {
        onChunk?.(blob);
      }

      if (shouldContinueRef.current) {
        startSegment();
        return;
      }

      cleanupStream();
      setStatus("idle");
    };

    recorder.start();
  }

  async function start() {
    if (status === "recording" || status === "requesting") {
      return;
    }

    try {
      setStatus("requesting");
      setError(null);
      shouldContinueRef.current = true;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startSegment();
    } catch {
      shouldContinueRef.current = false;
      cleanupStream();
      setStatus("error");
      setError("Microphone access was blocked or unavailable.");
    }
  }

  function stop() {
    shouldContinueRef.current = false;
    stopSegment();
  }

  function flushCurrentChunk() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      flushResolversRef.current.push(resolve);
      stopSegment();
    });
  }

  function toggle() {
    if (status === "recording") {
      stop();
      return;
    }

    void start();
  }

  return {
    error,
    flushCurrentChunk,
    isRecording: status === "recording",
    start,
    status,
    stop,
    toggle,
  };
}
