import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  setDoc, 
  doc, 
  getDoc,
  where,
  limit
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { db, auth, signIn, logOut } from './firebase';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Send, 
  LogOut, 
  LogIn, 
  Users, 
  MessageSquare,
  Play,
  Square,
  ChevronRight,
  User as UserIcon,
  Radio
} from 'lucide-react';
import { cn } from './lib/utils';

// --- Types ---
interface ChatMessage {
  id: string;
  uid: string;
  displayName: string;
  text: string;
  createdAt: any;
}

interface UserProfile {
  uid: string;
  displayName: string;
}

interface Stream {
  id: string;
  title: string;
  hostUid: string;
  hostName: string;
  status: 'live' | 'ended';
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeStream, setActiveStream] = useState<Stream | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMediaFileActive, setIsMediaFileActive] = useState(false);
  const [isMediaPlaying, setIsMediaPlaying] = useState(false);
  const [mediaVolume, setMediaVolume] = useState(1);
  const [mediaProgress, setMediaProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [viewMode, setViewMode] = useState<'lobby' | 'stream'>('lobby');
  const [error, setError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const mediaFileVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const fileStreamRef = useRef<MediaStream | null>(null);

  // --- Media File Event Listeners ---
  useEffect(() => {
    const video = mediaFileVideoRef.current;
    if (!video) return;

    const handlePlay = () => setIsMediaPlaying(true);
    const handlePause = () => setIsMediaPlaying(false);
    const handleTimeUpdate = () => {
      if (video.duration) {
        setMediaProgress((video.currentTime / video.duration) * 100);
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, []);

  // --- Anonymous User Init ---
  useEffect(() => {
    const storedUid = localStorage.getItem('we-share-uid');
    const storedName = localStorage.getItem('we-share-name');
    
    let uid = storedUid;
    let name = storedName;

    if (!uid || !name) {
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      uid = `user_${randomNum}_${Date.now()}`;
      name = `User ${randomNum}`;
      localStorage.setItem('we-share-uid', uid);
      localStorage.setItem('we-share-name', name);
    }

    const profile = { uid, displayName: name };
    setUser(profile);
    setIsAuthReady(true);

    // Sync user profile to Firestore (optional but helpful for discovery)
    setDoc(doc(db, 'users', uid), {
      ...profile,
      lastSeen: serverTimestamp()
    }, { merge: true });
  }, []);

  // --- Socket.io & WebRTC Init ---
  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('offer', async ({ offer, from }) => {
      if (!peerConnectionRef.current) createPeerConnection();
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnectionRef.current?.createAnswer();
      await peerConnectionRef.current?.setLocalDescription(answer);
      socketRef.current?.emit('answer', { roomId: activeStream?.id, answer });
    });

    socketRef.current.on('answer', async ({ answer }) => {
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socketRef.current.on('ice-candidate', async ({ candidate }) => {
      await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [activeStream]);

  // --- Fetch Streams ---
  useEffect(() => {
    if (!isAuthReady) return;
    const q = query(collection(db, 'streams'), where('status', '==', 'live'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const s = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Stream));
      setStreams(s);
    });
    return () => unsubscribe();
  }, [isAuthReady]);

  // --- Fetch Messages ---
  useEffect(() => {
    if (!activeStream) return;
    const q = query(
      collection(db, 'streams', activeStream.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(50)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const m = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
      setMessages(m);
    });
    return () => unsubscribe();
  }, [activeStream]);

  // --- WebRTC Helpers ---
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', { roomId: activeStream?.id, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    peerConnectionRef.current = pc;
    return pc;
  };

  const startStreaming = async () => {
    setError(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (e: any) {
        console.warn("Could not get both video and audio, trying fallback...", e);
        if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
          throw new Error("No camera or microphone found. Please ensure they are connected and try again.");
        } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          throw new Error("Permission denied. Please allow camera and microphone access in your browser settings.");
        } else {
          throw new Error("Could not access camera or microphone. Please check your device settings.");
        }
      }

      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      
      const streamDoc = await addDoc(collection(db, 'streams'), {
        title: `${user?.displayName}'s Stream`,
        hostUid: user?.uid,
        hostName: user?.displayName,
        status: 'live',
        createdAt: serverTimestamp()
      });

      const newStream = { id: streamDoc.id, title: `${user?.displayName}'s Stream`, hostUid: user?.uid!, hostName: user?.displayName!, status: 'live' as const };
      setActiveStream(newStream);
      socketRef.current?.emit('join-room', streamDoc.id);
      setIsStreaming(true);
      setViewMode('stream');
    } catch (err: any) {
      console.error("Error starting stream:", err);
      setError(err.message || "An unexpected error occurred while starting the stream.");
    }
  };

  const joinStream = async (stream: Stream) => {
    setActiveStream(stream);
    setViewMode('stream');
    socketRef.current?.emit('join-room', stream.id);
    
    const pc = createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('offer', { roomId: stream.id, offer });
  };

  const stopStreaming = async () => {
    if (activeStream) {
      await setDoc(doc(db, 'streams', activeStream.id), { status: 'ended' }, { merge: true });
    }
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    screenStreamRef.current?.getTracks().forEach(track => track.stop());
    fileStreamRef.current?.getTracks().forEach(track => track.stop());
    peerConnectionRef.current?.close();
    setIsStreaming(false);
    setIsScreenSharing(false);
    setViewMode('lobby');
    setActiveStream(null);
  };

  const toggleScreenShare = async () => {
    if (!isStreaming) return;

    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
        
        const videoTrack = screenStream.getVideoTracks()[0];
        
        // Replace track in peer connection
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find(s => s.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(videoTrack);
          }
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        videoTrack.onended = () => {
          stopScreenShare();
        };

        setIsScreenSharing(true);
      } else {
        stopScreenShare();
      }
    } catch (err) {
      console.error("Error toggling screen share:", err);
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }

    // Switch back to camera
    if (localStreamRef.current && peerConnectionRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(s => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(videoTrack);
      }
    }

    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }

    setIsScreenSharing(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isStreaming) return;

    const url = URL.createObjectURL(file);
    if (mediaFileVideoRef.current) {
      mediaFileVideoRef.current.src = url;
      mediaFileVideoRef.current.play();
      setIsMediaFileActive(true);

      // Capture stream from video element
      // @ts-ignore - captureStream is not in standard TS types yet
      const stream = mediaFileVideoRef.current.captureStream ? mediaFileVideoRef.current.captureStream() : mediaFileVideoRef.current.mozCaptureStream();
      fileStreamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      
      // Replace track in peer connection
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(videoTrack);
        }
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      mediaFileVideoRef.current.onended = () => {
        stopFilePlayback();
      };
    }
  };

  const stopFilePlayback = () => {
    if (fileStreamRef.current) {
      fileStreamRef.current.getTracks().forEach(track => track.stop());
      fileStreamRef.current = null;
    }

    if (mediaFileVideoRef.current) {
      mediaFileVideoRef.current.src = "";
    }

    setIsMediaFileActive(false);
    setIsMediaPlaying(false);
    setMediaProgress(0);

    // Switch back to camera
    if (localStreamRef.current && peerConnectionRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(s => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(videoTrack);
      }
    }

    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  };

  const toggleMediaPlay = () => {
    if (mediaFileVideoRef.current) {
      if (isMediaPlaying) mediaFileVideoRef.current.pause();
      else mediaFileVideoRef.current.play();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setMediaVolume(vol);
    if (mediaFileVideoRef.current) {
      mediaFileVideoRef.current.volume = vol;
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTo = parseFloat(e.target.value);
    if (mediaFileVideoRef.current && mediaFileVideoRef.current.duration) {
      mediaFileVideoRef.current.currentTime = (seekTo / 100) * mediaFileVideoRef.current.duration;
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeStream || !user) return;

    await addDoc(collection(db, 'streams', activeStream.id, 'messages'), {
      uid: user.uid,
      displayName: user.displayName,
      text: newMessage,
      createdAt: serverTimestamp()
    });
    setNewMessage('');
  };

  if (!isAuthReady || !user) return <div className="h-screen flex items-center justify-center bg-zinc-950 text-white font-black italic uppercase tracking-widest animate-pulse">Initializing...</div>;

  return (
    <div className="h-screen bg-zinc-950 text-white flex flex-col overflow-hidden font-sans">
      {/* Header */}
      <header className="p-4 flex items-center justify-between border-b border-zinc-900 bg-zinc-950/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <span className="font-black tracking-tighter uppercase italic text-xl">We Share</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none">Your ID</span>
            <span className="text-xs font-bold text-orange-500">{user.displayName}</span>
          </div>
          <div className="w-8 h-8 bg-zinc-900 rounded-full flex items-center justify-center border border-zinc-800">
            <UserIcon className="w-4 h-4 text-zinc-500" />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {viewMode === 'lobby' ? (
            <motion.div 
              key="lobby"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-4 space-y-8"
            >
              {/* Hero / Action */}
              <section className="bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 rounded-3xl border border-zinc-800 shadow-xl">
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs font-medium flex items-center gap-2"
                  >
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    {error}
                  </motion.div>
                )}
                <div className="flex items-center justify-between mb-6">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-bold">Ready to go live?</h2>
                    <p className="text-zinc-400 text-sm">Share your world with everyone.</p>
                  </div>
                  <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center">
                    <Video className="w-6 h-6 text-orange-500" />
                  </div>
                </div>
                <button 
                  onClick={startStreaming}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
                >
                  <Play className="w-5 h-5 fill-current" />
                  Start Broadcast
                </button>
              </section>

              {/* Live Now */}
              <section className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    Live Now
                  </h3>
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{streams.length} Active</span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {streams.length > 0 ? streams.map(s => (
                    <motion.div 
                      key={s.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => joinStream(s)}
                      className="group bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden hover:bg-zinc-900 transition-all cursor-pointer flex flex-col"
                    >
                      <div className="aspect-video bg-zinc-800 relative flex items-center justify-center overflow-hidden">
                        <UserIcon className="w-12 h-12 text-zinc-700" />
                        <div className="absolute top-3 left-3 bg-red-500 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-tighter flex items-center gap-1 shadow-lg">
                          <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
                          Live
                        </div>
                        <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md text-[10px] font-bold px-2 py-1 rounded-full text-white/90">
                          1.2k watching
                        </div>
                      </div>
                      <div className="p-4 flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center font-black text-xs">
                          {s.hostName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold truncate text-sm">{s.title}</h4>
                          <p className="text-xs text-zinc-500 truncate">@{s.hostName}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                      </div>
                    </motion.div>
                  )) : (
                    <div className="col-span-full py-12 text-center space-y-3">
                      <div className="w-16 h-16 bg-zinc-900 rounded-full mx-auto flex items-center justify-center">
                        <VideoOff className="w-8 h-8 text-zinc-800" />
                      </div>
                      <p className="text-zinc-500 font-medium">No active streams right now.</p>
                    </div>
                  )}
                </div>
              </section>
            </motion.div>
          ) : (
            <motion.div 
              key="stream"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="h-full flex flex-col relative"
            >
              {/* Video Area */}
              <div className="flex-1 bg-black relative overflow-hidden">
                <video 
                  ref={isStreaming ? localVideoRef : remoteVideoRef}
                  autoPlay 
                  playsInline 
                  muted={isStreaming}
                  className="w-full h-full object-cover"
                />
                
                {/* Hidden video for media file playback */}
                <video ref={mediaFileVideoRef} className="hidden" muted />
                
                {/* Overlay UI */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md p-2 pr-4 rounded-full border border-white/10">
                      <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center overflow-hidden">
                        <UserIcon className="w-5 h-5 text-zinc-500" />
                      </div>
                      <div>
                        <p className="text-xs font-bold leading-none">{activeStream?.hostName}</p>
                        <p className="text-[10px] text-zinc-400">Live • 1.2k watching</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {isStreaming && (
                        <>
                          <button 
                            onClick={toggleScreenShare}
                            className={cn(
                              "p-2 rounded-full transition-colors",
                              isScreenSharing ? "bg-orange-500 text-white" : "bg-black/40 text-white hover:bg-black/60"
                            )}
                            title="Share Screen"
                          >
                            <Play className="w-5 h-5" />
                          </button>
                          <label className="p-2 rounded-full bg-black/40 text-white hover:bg-black/60 cursor-pointer transition-colors" title="Play Media File">
                            <Video className="w-5 h-5" />
                            <input type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} />
                          </label>
                        </>
                      )}
                      <button 
                        onClick={stopStreaming}
                        className="bg-red-500 text-white px-4 py-2 rounded-full font-bold text-sm shadow-lg shadow-red-500/20"
                      >
                        {isStreaming ? 'End' : 'Leave'}
                      </button>
                    </div>
                  </div>

                  {/* Chat Overlay */}
                  <div className="max-h-[40%] overflow-y-auto space-y-2 mask-linear-gradient">
                    {messages.map(m => (
                      <div key={m.id} className="flex items-start gap-2 animate-in slide-in-from-left-2 duration-300">
                        <span className="text-xs font-black text-orange-400 whitespace-nowrap">{m.displayName}:</span>
                        <span className="text-xs text-white/90 leading-relaxed">{m.text}</span>
                      </div>
                    ))}
                  </div>

                  {/* Media Controls Overlay */}
                  {isStreaming && isMediaFileActive && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-black/60 backdrop-blur-xl p-4 rounded-3xl border border-white/10 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={toggleMediaPlay}
                            className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center active:scale-90 transition-transform"
                          >
                            {isMediaPlaying ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                          </button>
                          <button 
                            onClick={stopFilePlayback}
                            className="w-10 h-10 bg-zinc-800 text-white rounded-full flex items-center justify-center active:scale-90 transition-transform"
                          >
                            <VideoOff className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 flex-1 max-w-[120px] ml-4">
                          <Mic className="w-3 h-3 text-zinc-400" />
                          <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.1" 
                            value={mediaVolume}
                            onChange={handleVolumeChange}
                            className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={mediaProgress}
                          onChange={handleSeek}
                          className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                        />
                        <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-zinc-500">
                          <span>Media Playback</span>
                          <span>{Math.round(mediaProgress)}%</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Chat Input */}
              <div className="p-4 bg-zinc-950 border-t border-zinc-900">
                <form onSubmit={sendMessage} className="flex gap-2">
                  <input 
                    type="text" 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Say something..."
                    className="flex-1 bg-zinc-900 border-none rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500 transition-all"
                  />
                  <button 
                    type="submit"
                    className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/20 active:scale-95 transition-transform"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Nav (Only in Lobby) */}
      {viewMode === 'lobby' && (
        <nav className="p-4 pb-8 flex justify-around border-t border-zinc-900 bg-zinc-950/80 backdrop-blur-xl">
          <button className="flex flex-col items-center gap-1 text-orange-500">
            <Radio className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Explore</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-zinc-500">
            <Users className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Friends</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-zinc-500">
            <MessageSquare className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Inbox</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-zinc-500">
            <UserIcon className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Profile</span>
          </button>
        </nav>
      )}
    </div>
  );
}
