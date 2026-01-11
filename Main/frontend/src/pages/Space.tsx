import * as mediasoupClient from "mediasoup-client";
import { Device } from "mediasoup-client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useSocket } from "../context/SocketProvider";
import options from "../constants/options";
import mediaOptions from "../constants/mediaOptions";
import {
  type Transport,
  type AppData,
  type TransportOptions,
  type RtpCapabilities,
  type Producer,
} from "mediasoup-client/types";

interface RemoteMedia {
  producerId: string;
  consumerId: string;
  kind: "video" | "audio";
  stream: MediaStream;
  paused?: boolean;
}

const RemoteVideo = ({ stream }: { stream: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="h-full w-full object-cover"
    />
  );
};

const RemoteAudio = ({ stream }: { stream: MediaStream }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current
        .play()
        .catch((e) => console.error("Audio play error", e));
    }
  }, [stream]);
  return <audio ref={audioRef} autoPlay />;
};

export const Space = () => {
  const { roomName } = useParams();
  const socket = useSocket();
  const [remoteMedia, setRemoteMedia] = useState<RemoteMedia[]>([]);
  const [status, setStatus] = useState("Initializing...");
  const pendingProducers = useRef<string[]>([]);
  const deviceRef = useRef<Device | null>(null);
  const consumerTransportRef = useRef<Transport | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const startedRef = useRef<boolean>(false);

  //tracking video and auccdio
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const videoProducerRef = useRef<Producer | null>(null);
  const audioProducerRef = useRef<Producer | null>(null);
  const producerTransportRef = useRef<Transport | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);

  const getOrCreateRecvTransport = async () => {
    if (consumerTransportRef.current) return consumerTransportRef.current;
    if (!deviceRef.current) return null;

    try {
      const transportParams: TransportOptions<AppData> =
        await socket.sendRequest("createWebRtcTransport", { sender: false });

      const consumerTransport =
        deviceRef.current.createRecvTransport(transportParams);

      consumerTransport.on("connectionstatechange", (state) => {
        console.log(` Recv Transport State: ${state}`);
        if (state === "connected") setStatus("Transport Connected");
        if (state === "failed") setStatus("Transport Failed (Check Server IP)");
      });

      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          console.log("Transport connecting...");
          try {
            await socket.sendRequest("transport-recv-connect", {
              dtlsParameters,
            });
            callback();
          } catch (error: any) {
            console.error("Transport connect error:", error);
            errback(error);
          }
        }
      );

      consumerTransportRef.current = consumerTransport;
      return consumerTransport;
    } catch (error) {
      console.error("Error creating recv transport", error);
      return null;
    }
  };

  const consumeProducer = async (producerId: string) => {
    console.log(`Attempting to consume producer: ${producerId}`);

    if (!deviceRef.current) await createDevice();
    if (!deviceRef.current) return; // Fail safe

    const transport = await getOrCreateRecvTransport();
    if (!transport) {
      console.error("Failed to create transport");
      return;
    }

    try {
      const data: any = await socket.sendRequest("consume", {
        rtpCapabilities: deviceRef.current.rtpCapabilities,
        producerId,
      });

      const consumer = await transport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      setRemoteMedia((prev) => [
        ...prev,
        {
          producerId,
          consumerId: consumer.id,
          kind: consumer.kind,
          stream: new MediaStream([consumer.track]),
        },
      ]);

      await socket.sendRequest("consumer-resume", { consumerId: data.id });
      console.log(`Consumed ${consumer.kind} successfully`);
    } catch (error) {
      console.error("Consumption failed:", error);
    }
  };

  const tryConsumePending = async () => {
    if (!deviceRef.current) return;
    while (pendingProducers.current.length > 0) {
      const pId = pendingProducers.current.shift()!;
      if (!remoteMedia.some((m) => m.producerId === pId)) {
        await consumeProducer(pId);
      }
    }
  };

  const createDevice = async () => {
    if (deviceRef.current) return deviceRef.current;

    try {
      const rtpCaps = await socket.sendRequest<RtpCapabilities>(
        "getRtpCapabilities"
      );
      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: rtpCaps });
      deviceRef.current = device;
      console.log("Device Loaded");
      tryConsumePending();
      return device;
    } catch (error) {
      console.error("Device load failed", error);
      return null;
    }
  };

  //extracting the producer logic from onVideo() so we can use toggle of video and audio effiecitnelty
  const initializeProducers = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(mediaOptions);
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play();
      }

      if (!producerTransportRef.current) {
        const params: any = await socket.sendRequest("createWebRtcTransport", {
          sender: true,
        });

        if (!deviceRef.current) return;

        const transport = deviceRef.current.createSendTransport(params);

        transport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              await socket.sendRequest("transport-connect", { dtlsParameters });
              callback();
            } catch (err: any) {
              errback(err);
            }
          }
        );

        transport.on("produce", async (parameters, callback, errback) => {
          try {
            const data: any = await socket.sendRequest("transport-produce", {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            });
            callback({ id: data.id });
          } catch (err: any) {
            errback(err);
          }
        });

        producerTransportRef.current = transport;
      }

      //creating video producer
      const videoTrack = stream.getVideoTracks()[0];
      videoProducerRef.current = await producerTransportRef.current.produce({
        track: videoTrack,
        ...options,
      });

      //creating audio producer
      const audioTrack = stream.getAudioTracks()[0];
      audioProducerRef.current = await producerTransportRef.current.produce({
        track: audioTrack,
      });

      //pausing both at start
      videoProducerRef.current.pause();
      audioProducerRef.current.pause();

      setIsVideoOn(false);
      setIsAudioOn(false);
    } catch (error: any) {
      console.error("Initialze producers error: ", error);
    }
  };

  const onVideo = async () => {
    try {
      //Initing producers if not already done
      if (!videoProducerRef.current) {
        await initializeProducers();
      }

      if (videoProducerRef.current) {
        if (isVideoOn) {
          //Pause video :- if the video on already

          videoProducerRef.current.pause();
          //also disabling the track for current usr
          const videoTrack = localStreamRef.current?.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = false;
          }
          setIsVideoOn(false);
        } else {
          //Resuming video
          videoProducerRef.current.resume();
          //Enable the track
          const videoTrack = localStreamRef.current?.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = true;
          }
          setIsVideoOn(true);
        }
      }
    } catch (error) {
      console.error("Video toggle error: ", error);
    }
  };

  const onAudio = async () => {
    try {
      //Initialse producers if not alreay odne

      if (!audioProducerRef.current) {
        await initializeProducers();
      }

      if (audioProducerRef.current) {
        if (isAudioOn) {
          //Pause audio
          audioProducerRef.current.pause();

          //Also disable the track
          const audioTrack = localStreamRef.current?.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = false;
          }

          setIsAudioOn(false);
        } else {
          //Resume audio
          audioProducerRef.current.resume();
          //Enable the UI track
          const audioTrack = localStreamRef.current?.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = true;
          }

          setIsAudioOn(true);
        }
      }
    } catch (error: any) {
      console.error("Audio toggle error: ", error);
    }
  };

  const offAudio = async () => {
    //This is just an alias for onAudio when audio is on
    if (isAudioOn) {
      await onAudio();
    }
  };

  const offVideo = async () => {
    // This is now just an alias for onVideo when video is on
    if (isVideoOn) {
      await onVideo();
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Listeners
    socket.onExistingProducers((producers) => {
      console.log("Found existing producers:", producers);
      producers.forEach((p: any) =>
        pendingProducers.current.push(p.producerId)
      );
      tryConsumePending();
    });

    socket.onNewProducerArrives((p) => {
      console.log("New producer:", p);
      pendingProducers.current.push(p.producerId);
      tryConsumePending();
    });

    socket.onProducerPaused((data) => {
      console.log("Producer paused: ", data);
      setRemoteMedia((prev) =>
        prev.map((m) =>
          m.producerId === data.producerId ? { ...m, paused: true } : m
        )
      );
    });
    socket.onProducerResumed((data) => {
      console.log("Producer Resumed: ", data);
      setRemoteMedia((prev) =>
        prev.map((m) =>
          m.producerId === data.producerId ? { ...m, paused: false } : m
        )
      );
    });

    socket.onProducerClosed((data) => {
      console.log("Producer closed: ", data);

      const removed = remoteMedia.find((m) => m.producerId === data.producerId);
      if (removed) {
        setNotifications((prev) => [...prev, `${removed.kind} stream ended`]);
        setTimeout(() => {
          setNotifications((prev) => prev.slice(1));
        }, 3000);

        removed.stream.getTracks().forEach((track) => track.stop());
      }

      setRemoteMedia((prev) => {
        const filtered = prev.filter((m) => m.producerId !== data.producerId);

        // Stop the track for cleanup
        const removed = prev.find((m) => m.producerId === data.producerId);
        if (removed) {
          removed.stream.getTracks().forEach((track) => track.stop());
        }

        return filtered;
      });
    });

    // Init
    const init = async () => {
      console.log("Joining Room...");
      await socket.sendRequest("join-room", { roomId: roomName });
      await createDevice();
      setStatus("Joined & Device Ready");
    };
    init();

    return () => {
      if (consumerTransportRef.current) consumerTransportRef.current.close();
    };
  }, [roomName]);

  return (
    <div className="h-screen w-full bg-gray-900 text-white p-4">
      <div className="mb-4 text-center text-yellow-400 font-mono">{status}</div>
      <div className="flex h-[90%] gap-4">
        {/* Local Video */}
        <div className="w-1/2 bg-gray-800 rounded p-2 flex flex-col items-center">
          <h2 className="mb-2">Local</h2>
          <div className="relative w-full">
            <video
              ref={localVideoRef}
              muted
              autoPlay
              playsInline
              className="w-full h-auto bg-black rounded"
            />
            {!isVideoOn && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900 rounded">
                <span className="text-gray-400 text-2xl">📷 Camera Off</span>
              </div>
            )}
            {!isAudioOn && (
              <div className="absolute top-2 left-2 bg-red-600 px-2 py-1 rounded text-xs">
                🔇 Muted
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={onVideo}
              className={`px-4 py-2 rounded transition-colors ${
                isVideoOn
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-blue-600 hover:bg-blue-500"
              }`}
            >
              {isVideoOn ? "📷 Turn Off Camera" : "📷 Turn On Camera"}
            </button>
            <button
              onClick={onAudio}
              className={`px-4 py-2 rounded transition-colors ${
                isAudioOn
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-blue-600 hover:bg-blue-500"
              }`}
            >
              {isAudioOn ? "🎤 Turn Off Mic" : "🎤 Turn On Mic"}
            </button>
          </div>
        </div>
        {/* Remote Videos */}
        <div className="w-1/2 bg-pink-900 rounded p-2 flex flex-wrap gap-2 content-start overflow-y-auto">
          <h2 className="w-full text-center mb-2">Remote (Pink Side)</h2>

          {/* Render only videos in boxes */}
          {remoteMedia
            .filter((m) => m.kind === "video")
            .map((m) => {
              // Find if this producer also has audio
              const hasAudio = remoteMedia.find(
                (media) =>
                  media.producerId.replace("-video", "-audio") ===
                    m.producerId.replace("-video", "-audio") &&
                  media.kind === "audio"
              );
              const isAudioPaused = hasAudio?.paused;

              return (
                <div
                  key={m.consumerId}
                  className="w-64 h-48 bg-black rounded border border-pink-500 relative"
                >
                  {/* we will only show video if it not puased */}
                  {!m.paused && <RemoteVideo stream={m.stream} />}
                  {m.paused && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-75">
                      <span className="text-white text-4xl mb-2">📷</span>
                      <span className="text-white text-sm">Camera Paused</span>
                    </div>
                  )}
                  {isAudioPaused && !m.paused && (
                    <div className="absolute bottom-2 left-2 bg-red-600 px-2 py-1 rounded text-xs flex items-center gap-1">
                      🔇 Muted
                    </div>
                  )}
                </div>
              );
            })}

          {/* Rendering audio elements (hidden but functional) */}
          {remoteMedia
            .filter((m) => m.kind === "audio")
            .map((m) => (
              <RemoteAudio key={m.consumerId} stream={m.stream} />
            ))}
        </div>
      </div>
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 space-y-2">
          {notifications.map((msg, i) => (
            <div
              key={i}
              className="bg-yellow-600 text-white px-4 py-2 rounded shadow-lg"
            >
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
