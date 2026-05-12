
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { RoomSidebar } from "./RoomSidebar";
import { Bug, Headphones, Hash, Menu, Mic, MicOff, PhoneOff, Paperclip, Search, Send, Settings, Smile, Users, Volume2, Wifi, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useMemoFirebase, useCollection } from "@/firebase";
import { doc, collection, serverTimestamp, getDocs, query, where, writeBatch, orderBy, limit, onSnapshot, Unsubscribe, deleteDoc } from "firebase/firestore";
import {
  setDocumentNonBlocking,
  addDocumentNonBlocking,
} from "@/firebase/non-blocking-updates";
import {
  getLocalAudioStream,
  createPeerConnection,
  addLocalTracks,
  closePeerConnection,
  createOffer,
  createAnswer,
  setRemoteDescription,
  addIceCandidate,
  stopMediaStream,
  type AudioSettings,
} from "@/lib/webrtc";
import { AudioSettingsDialog } from "./AudioSettingsDialog";
import { AdminPanel } from "./AdminPanel";
import { UserRole } from "@/app/page";

interface MainAppProps {
  userName: string;
  userId: string;
  userRole: UserRole;
  onLogout: () => void;
}

interface VoicePresence {
  id: string;
  userId?: string;
  displayName?: string;
  lastSeen?: string;
  isKicked?: boolean;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
  isSharingScreen?: boolean;
  isCameraOn?: boolean;
}

type ActiveVoicePresence = VoicePresence & {
  userId: string;
  displayName: string;
  lastSeen: string;
};

interface PeerRuntimeState {
  callId: string;
  isOfferer: boolean;
  callSessionId?: string;
  handledOfferSessionId?: string;
  handledAnswerSessionId?: string;
  handledReconnectRequestKey?: string;
  pendingIce: RTCIceCandidateInit[];
  pendingCandidateDocs: Array<{ id: string; callSessionId?: string; candidate: RTCIceCandidateInit }>;
  processedIce: Set<string>;
  hasRemoteDescription: boolean;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  connectionTimer?: ReturnType<typeof setTimeout>;
  status: PeerConnectionStatus;
}

type PeerConnectionStatus = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";
type ConnectionQuality = "excellent" | "good" | "poor" | "reconnecting";

interface PeerDebugInfo {
  status: PeerConnectionStatus;
  iceState?: RTCIceConnectionState;
  signalingState?: RTCSignalingState;
  attempts: number;
  callId?: string;
  isOfferer?: boolean;
  callSessionId?: string;
  quality?: ConnectionQuality;
  localTrackCount?: number;
  remoteTrackCount?: number;
  audioPlayStatus?: "idle" | "playing" | "blocked" | "failed";
  lastError?: string;
  needsTurnHint?: boolean;
  timedOut?: boolean;
}

interface VoiceAnalyserCleanup {
  stop: () => void;
}

interface LocalMicDebug {
  permission: "granted" | "denied" | "prompt" | "unknown" | "pending";
  trackCount: number;
  enabledCount: number;
  lastError?: string;
}

const MAX_VOICE_USERS = 5;
const ACTIVE_PRESENCE_MS = 15000;
const STALE_PRESENCE_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 3;

export function MainApp({ userName, userId, userRole, onLogout }: MainAppProps) {
  const [activeView, setActiveView] = useState<{ type: 'text' | 'voice', id: string }>({ type: 'text', id: 'Genel' });
  const [joinedVoiceChannel, setJoinedVoiceChannel] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [isVoiceDebugOpen, setIsVoiceDebugOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [voiceDebugLogs, setVoiceDebugLogs] = useState<string[]>([]);
  const [peerDebug, setPeerDebug] = useState<Record<string, PeerDebugInfo>>({});
  const [blockedAudioUserIds, setBlockedAudioUserIds] = useState<string[]>([]);
  const [remoteSpeaking, setRemoteSpeaking] = useState<Record<string, boolean>>({});
  const [peerQuality, setPeerQuality] = useState<Record<string, ConnectionQuality>>({});
  const [localMicDebug, setLocalMicDebug] = useState<LocalMicDebug>({
    permission: "unknown",
    trackCount: 0,
    enabledCount: 0,
  });

  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});
  const [audioSettings, setAudioSettings] = useState<AudioSettings & { outputDeviceId?: string }>({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    micSensitivity: 0.03,
    gateLevel: 0.5,
    gateSmoothing: 0.5,
    micGain: 1.0,
    deviceId: "default",
    outputDeviceId: "default",
    qualityMode: "balanced"
  });

  const { toast } = useToast();
  const db = useFirestore();

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const peerStatesRef = useRef<Record<string, PeerRuntimeState>>({});
  const remoteAudiosRef = useRef<Record<string, HTMLAudioElement>>({});
  const signalingUnsubsRef = useRef<Record<string, Unsubscribe>>({});
  const userVolumesRef = useRef<Record<string, number>>({});
  const isDeafenedRef = useRef(false);
  const isCleaningUpRef = useRef(false);
  const connectionSessionRef = useRef(0);
  const dbRef = useRef(db);
  const peerQualityRef = useRef<Record<string, ConnectionQuality>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const localAnalyserCleanupRef = useRef<VoiceAnalyserCleanup | null>(null);
  const remoteAnalyserCleanupsRef = useRef<Record<string, VoiceAnalyserCleanup>>({});
  const managedAudioContextsRef = useRef<Set<AudioContext>>(new Set());

  useEffect(() => {
    userVolumesRef.current = userVolumes;
  }, [userVolumes]);

  useEffect(() => {
    isDeafenedRef.current = isDeafened;
  }, [isDeafened]);

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  useEffect(() => {
    peerQualityRef.current = peerQuality;
  }, [peerQuality]);

  const appendVoiceLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setVoiceDebugLogs((prev) => [`${stamp} ${message}`, ...prev].slice(0, 80));
  }, []);

  const updatePeerDebug = useCallback((targetId: string, patch: Partial<PeerDebugInfo>) => {
    setPeerDebug((prev) => {
      const state = peerStatesRef.current[targetId];
      return {
        ...prev,
        [targetId]: {
          ...prev[targetId],
          status: state?.status ?? prev[targetId]?.status ?? "new",
          attempts: state?.reconnectAttempts ?? prev[targetId]?.attempts ?? 0,
          callId: state?.callId ?? prev[targetId]?.callId,
          isOfferer: state?.isOfferer ?? prev[targetId]?.isOfferer,
          callSessionId: state?.callSessionId ?? prev[targetId]?.callSessionId,
          ...patch,
        },
      };
    });
  }, []);

  const refreshLocalMicDebug = useCallback((stream: MediaStream | null, patch?: Partial<LocalMicDebug>) => {
    const tracks = stream?.getAudioTracks() ?? [];
    setLocalMicDebug((prev) => ({
      ...prev,
      trackCount: tracks.length,
      enabledCount: tracks.filter((track) => track.enabled && track.readyState === "live").length,
      ...patch,
    }));
  }, []);

  const createSpeakingAnalyser = useCallback((
    stream: MediaStream,
    onSpeakingChange: (speaking: boolean) => void,
    options?: { threshold?: number; holdMs?: number }
  ): VoiceAnalyserCleanup | null => {
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor || stream.getAudioTracks().length === 0) return null;

      const audioContext = new AudioContextCtor({ latencyHint: "interactive" });
      managedAudioContextsRef.current.add(audioContext);
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      const threshold = options?.threshold ?? 0.035;
      const holdMs = options?.holdMs ?? 260;
      let animationFrame = 0;
      let lastCheck = 0;
      let lastVoiceAt = 0;
      let currentSpeaking = false;
      let stopped = false;

      const tick = (now: number) => {
        if (stopped) return;
        animationFrame = requestAnimationFrame(tick);
        if (now - lastCheck < 70) return;
        lastCheck = now;

        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
          const centered = (data[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        if (rms > threshold) lastVoiceAt = now;
        const nextSpeaking = now - lastVoiceAt < holdMs;

        if (nextSpeaking !== currentSpeaking) {
          currentSpeaking = nextSpeaking;
          onSpeakingChange(nextSpeaking);
        }
      };

      animationFrame = requestAnimationFrame(tick);

      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          cancelAnimationFrame(animationFrame);
          onSpeakingChange(false);
          source.disconnect();
          analyser.disconnect();
          managedAudioContextsRef.current.delete(audioContext);
          if (audioContext.state !== "closed") {
            void audioContext.close();
          }
        },
      };
    } catch (error) {
      console.warn("Speaking analyser baslatilamadi", error);
      return null;
    }
  }, []);

  const stopLocalSpeakingAnalyser = useCallback(() => {
    localAnalyserCleanupRef.current?.stop();
    localAnalyserCleanupRef.current = null;
  }, []);

  const stopRemoteSpeakingAnalyser = useCallback((targetId: string) => {
    remoteAnalyserCleanupsRef.current[targetId]?.stop();
    delete remoteAnalyserCleanupsRef.current[targetId];
    setRemoteSpeaking((prev) => {
      if (!prev[targetId]) return prev;
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  }, []);

  const startLocalSpeakingAnalyser = useCallback((stream: MediaStream | null) => {
    stopLocalSpeakingAnalyser();
    if (!stream) return;
    localAnalyserCleanupRef.current = createSpeakingAnalyser(stream, setIsSpeaking, {
      threshold: Math.max(0.025, audioSettings.micSensitivity * 0.65),
      holdMs: 320,
    });
  }, [audioSettings.micSensitivity, createSpeakingAnalyser, stopLocalSpeakingAnalyser]);

  const startRemoteSpeakingAnalyser = useCallback((targetId: string, stream: MediaStream) => {
    stopRemoteSpeakingAnalyser(targetId);
    const cleanup = createSpeakingAnalyser(stream, (speaking) => {
      setRemoteSpeaking((prev) => {
        if (prev[targetId] === speaking) return prev;
        return { ...prev, [targetId]: speaking };
      });
    }, { threshold: 0.03, holdMs: 360 });
    if (cleanup) remoteAnalyserCleanupsRef.current[targetId] = cleanup;
  }, [createSpeakingAnalyser, stopRemoteSpeakingAnalyser]);

  const attemptRemoteAudioPlay = useCallback(async (targetId: string, reason: string) => {
    const audio = remoteAudiosRef.current[targetId];
    if (!audio) return false;
    try {
      await Promise.all(Array.from(managedAudioContextsRef.current).map((context) => (
        context.state === "suspended" ? context.resume().catch(() => undefined) : Promise.resolve()
      )));
      audio.autoplay = true;
      audio.muted = isDeafenedRef.current;
      audio.volume = (userVolumesRef.current[targetId] ?? 100) / 100;
      await audio.play();
      setBlockedAudioUserIds((prev) => prev.filter((id) => id !== targetId));
      updatePeerDebug(targetId, { audioPlayStatus: "playing", lastError: undefined });
      appendVoiceLog(`${targetId}: audio play ok (${reason})`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Remote audio play failed", { targetId, reason, error });
      setBlockedAudioUserIds((prev) => prev.includes(targetId) ? prev : [...prev, targetId]);
      updatePeerDebug(targetId, {
        audioPlayStatus: "blocked",
        lastError: `audio play blocked: ${message}`,
      });
      appendVoiceLog(`${targetId}: audio play engellendi (${reason})`);
      return false;
    }
  }, [appendVoiceLog, updatePeerDebug]);

  const syncPeerDebug = useCallback((targetId: string) => {
    const state = peerStatesRef.current[targetId];
    if (!state) {
      setPeerDebug((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      return;
    }
    setPeerDebug((prev) => ({
      ...prev,
      [targetId]: {
        status: state.status,
        iceState: pcsRef.current[targetId]?.iceConnectionState,
        signalingState: pcsRef.current[targetId]?.signalingState,
        attempts: state.reconnectAttempts,
        callId: state.callId,
        isOfferer: state.isOfferer,
        callSessionId: state.callSessionId,
        quality: peerQualityRef.current[targetId],
        localTrackCount: pcsRef.current[targetId]?.getSenders().filter((sender) => sender.track?.kind === "audio").length,
      },
    }));
  }, []);

  const setPeerStatus = useCallback((targetId: string, status: PeerConnectionStatus) => {
    const state = peerStatesRef.current[targetId];
    if (!state || state.status === status) return;
    state.status = status;
    if (status === "connected") {
      state.reconnectAttempts = 0;
      if (state.connectionTimer) {
        clearTimeout(state.connectionTimer);
        state.connectionTimer = undefined;
      }
    }
    appendVoiceLog(`${targetId}: ${status}`);
    syncPeerDebug(targetId);
  }, [appendVoiceLog, syncPeerDebug]);

  const cleanupStalePresence = useCallback(async (channel: string) => {
    if (!dbRef.current) return;
    const snap = await getDocs(collection(dbRef.current, "voiceChannels", channel, "presence"));
    const now = Date.now();
    const batch = writeBatch(dbRef.current);
    let staleCount = 0;
    snap.docs.forEach((presenceDoc) => {
      const data = presenceDoc.data();
      const lastSeenTime = typeof data.lastSeen === "string" ? new Date(data.lastSeen).getTime() : NaN;
      if (!Number.isFinite(lastSeenTime) || now - lastSeenTime > STALE_PRESENCE_MS) {
        batch.delete(presenceDoc.ref);
        staleCount += 1;
      }
    });
    if (staleCount > 0) {
      await batch.commit();
      appendVoiceLog(`${channel}: ${staleCount} stale presence temizlendi`);
    }
  }, [appendVoiceLog]);

  const roomsQuery = useMemoFirebase(() => db ? query(collection(db, "textChannels"), limit(20)) : null, [db]);
  const { data: roomsData } = useCollection(roomsQuery);
  const rooms = useMemo(() => roomsData?.map(r => r.id) || ["Genel"], [roomsData]);

  const voiceChannelsQuery = useMemoFirebase(() => db ? query(collection(db, "voiceChannels"), limit(20)) : null, [db]);
  const { data: voiceChannelsData } = useCollection(voiceChannelsQuery);
  const voiceChannels = useMemo(() => voiceChannelsData?.map(v => v.id) || ["Genel Ses"], [voiceChannelsData]);

  const messagesQuery = useMemoFirebase(() => {
    if (!db || activeView.type !== 'text') return null;
    return query(collection(db, "textChannels", activeView.id, "messages"), orderBy("createdAt", "asc"), limit(50));
  }, [db, activeView]);
  const { data: messages } = useCollection(messagesQuery);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !db || activeView.type !== 'text') return;
    addDocumentNonBlocking(collection(db, "textChannels", activeView.id, "messages"), {
      text: messageText.trim(),
      userId,
      displayName: userName,
      createdAt: serverTimestamp(),
    });
    setMessageText("");
  };

  const presenceDataQuery = useMemoFirebase(() => db && joinedVoiceChannel ? collection(db, "voiceChannels", joinedVoiceChannel, "presence") : null, [db, joinedVoiceChannel]);
  const { data: presenceData } = useCollection(presenceDataQuery);
  
  const activeUsers = useMemo<ActiveVoicePresence[]>(() => {
    if (!presenceData) return [];
    const now = Date.now();
    const seen = new Set<string>();
    return presenceData.filter((u): u is ActiveVoicePresence => {
      if (!u.userId || !u.displayName || !u.lastSeen || u.isKicked) return false;
      if (seen.has(u.userId)) return false;
      const lastSeenTime = new Date(u.lastSeen).getTime();
      if (!Number.isFinite(lastSeenTime) || now - lastSeenTime >= ACTIVE_PRESENCE_MS) return false;
      seen.add(u.userId);
      return true;
    });
  }, [presenceData]);

  // KICK Takibi
  useEffect(() => {
    if (!db || !joinedVoiceChannel || !userId) return;
    const unsub = onSnapshot(doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId), (snap) => {
      if (snap.exists() && snap.data().isKicked) {
        handleLeaveVoiceChannel();
        toast({
          variant: "destructive",
          title: "Kanaldan Atıldın",
          description: "Bir yönetici tarafından bu ses kanalından uzaklaştırıldın."
        });
      }
    });
    return () => unsub();
  }, [db, joinedVoiceChannel, userId]);

  useEffect(() => {
    return () => {
      stopLocalSpeakingAnalyser();
      Object.keys(remoteAnalyserCleanupsRef.current).forEach(stopRemoteSpeakingAnalyser);
    };
  }, [stopLocalSpeakingAnalyser, stopRemoteSpeakingAnalyser]);

  const handleVolumeChange = useCallback((targetUserId: string, volume: number) => {
    setUserVolumes(prev => {
      const next = { ...prev, [targetUserId]: volume };
      localStorage.setItem("kanka_user_volumes", JSON.stringify(next));
      return next;
    });
    if (remoteAudiosRef.current[targetUserId]) {
      remoteAudiosRef.current[targetUserId].volume = volume / 100;
    }
  }, []);

  const handleSettingsChange = useCallback(async (newSettings: AudioSettings & { outputDeviceId?: string }) => {
    setAudioSettings(newSettings);
    if (joinedVoiceChannel && localStreamRef.current) {
      const oldStream = localStreamRef.current;
      const newStream = await getLocalAudioStream(newSettings);
      if (newStream) {
        localStreamRef.current = newStream;
        refreshLocalMicDebug(newStream, { permission: "granted", lastError: undefined });
        startLocalSpeakingAnalyser(newStream);
        newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        const nextAudioTrack = newStream.getAudioTracks()[0] ?? null;
        await Promise.all(Object.values(pcsRef.current).map(async (pc) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) {
            await sender.replaceTrack(nextAudioTrack);
          }
        }));
        stopMediaStream(oldStream);
      }
    }
  }, [joinedVoiceChannel, isMuted, refreshLocalMicDebug, startLocalSpeakingAnalyser]);

  const playSoundEffect = useCallback((type: 'join' | 'leave') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.05, now + 0.05);
      oscillator.type = 'sine';
      if (type === 'join') {
        oscillator.frequency.setValueAtTime(500, now);
        oscillator.frequency.exponentialRampToValueAtTime(700, now + 0.15);
      } else {
        oscillator.frequency.setValueAtTime(700, now);
        oscillator.frequency.exponentialRampToValueAtTime(500, now + 0.15);
      }
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      oscillator.start(now); oscillator.stop(now + 0.3);
      oscillator.onended = () => {
        if (audioCtx.state !== "closed") {
          void audioCtx.close();
        }
      };
    } catch (err) {}
  }, []);

  const cleanupPeer = useCallback((targetId: string) => {
    stopRemoteSpeakingAnalyser(targetId);
    const peerState = peerStatesRef.current[targetId];
    if (peerState?.reconnectTimer) {
      clearTimeout(peerState.reconnectTimer);
      peerState.reconnectTimer = undefined;
    }
    if (peerState?.connectionTimer) {
      clearTimeout(peerState.connectionTimer);
      peerState.connectionTimer = undefined;
    }

    if (signalingUnsubsRef.current[targetId]) {
      signalingUnsubsRef.current[targetId]();
      delete signalingUnsubsRef.current[targetId];
    }

    if (pcsRef.current[targetId]) {
      closePeerConnection(pcsRef.current[targetId]);
      delete pcsRef.current[targetId];
    }

    if (remoteAudiosRef.current[targetId]) {
      remoteAudiosRef.current[targetId].pause();
      remoteAudiosRef.current[targetId].srcObject = null;
      remoteAudiosRef.current[targetId].remove();
      delete remoteAudiosRef.current[targetId];
    }

    delete peerStatesRef.current[targetId];
    setBlockedAudioUserIds((prev) => prev.filter((id) => id !== targetId));
    setPeerQuality((prev) => {
      if (!prev[targetId]) return prev;
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
    setPeerDebug((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  }, [stopRemoteSpeakingAnalyser]);

  const handleLeaveVoiceChannel = useCallback(async () => {
    if (isCleaningUpRef.current) return;
    const channelToLeave = joinedVoiceChannel;
    console.log("🧹 tam cleanup başladı");
    isCleaningUpRef.current = true;
    connectionSessionRef.current += 1;
    
    setJoinedVoiceChannel(null);
    stopLocalSpeakingAnalyser();
    setIsSpeaking(false);
    playSoundEffect('leave');

    try {
      Object.keys(pcsRef.current).forEach(cleanupPeer);
      Object.keys(signalingUnsubsRef.current).forEach(cleanupPeer);
      Object.keys(remoteAudiosRef.current).forEach(cleanupPeer);
      peerStatesRef.current = {};
      setPeerDebug({});
      setBlockedAudioUserIds([]);
      setPeerQuality({});
      setRemoteSpeaking({});

      if (localStreamRef.current) {
        stopMediaStream(localStreamRef.current);
        localStreamRef.current = null;
      }

      if (db && channelToLeave && userId) {
        const batch = writeBatch(db);
        batch.delete(doc(db, "voiceChannels", channelToLeave, "presence", userId));
        
        const q1 = query(collection(db, "voiceChannels", channelToLeave, "calls"), where("offererId", "==", userId));
        const q2 = query(collection(db, "voiceChannels", channelToLeave, "calls"), where("answererId", "==", userId));
        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        
        const callDocs = [...snap1.docs, ...snap2.docs];
        for (const d of callDocs) {
          const candidateSnap = await getDocs(collection(d.ref, "candidates"));
          candidateSnap.docs.forEach((candidateDoc) => batch.delete(candidateDoc.ref));
          batch.delete(d.ref);
        }
        await batch.commit();
        console.log("🔥 Firestore çağrı kayıtları temizlendi");
      }
    } catch (e) { console.warn("Firestore cleanup hatası", e); }
    finally {
      isCleaningUpRef.current = false;
      console.log("✅ tam cleanup bitti");
    }
  }, [cleanupPeer, db, joinedVoiceChannel, userId, playSoundEffect, stopLocalSpeakingAnalyser]);

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    setActiveView({ type: 'voice', id: channel });
    if (joinedVoiceChannel === channel) return;
    
    while (isCleaningUpRef.current) await new Promise(r => setTimeout(r, 50));
    
    if (joinedVoiceChannel) await handleLeaveVoiceChannel();

    if (!db) {
      toast({ variant: "destructive", title: "Hata", description: "Firebase bağlantısı hazır değil." });
      return;
    }

    try {
      await deleteDoc(doc(db, "voiceChannels", channel, "presence", userId));
    } catch (e) {}

    await cleanupStalePresence(channel);
    const currentPresenceSnap = await getDocs(collection(db, "voiceChannels", channel, "presence"));
    const now = Date.now();
    const activeUserIds = new Set(currentPresenceSnap.docs.flatMap(d => {
      const data = d.data();
      if (!data.userId || data.userId === userId || data.isKicked || !data.lastSeen) return [];
      const lastSeenTime = new Date(data.lastSeen).getTime();
      return Number.isFinite(lastSeenTime) && now - lastSeenTime < ACTIVE_PRESENCE_MS ? [data.userId as string] : [];
    }));
    const activeUsersCount = activeUserIds.size;

    if (activeUsersCount >= MAX_VOICE_USERS) {
      toast({ 
        variant: "destructive", 
        title: "Kanal Dolu", 
        description: "Bu ses kanalı dolu. Maksimum 5 kişi katılabilir." 
      });
      return;
    }

    try {
      connectionSessionRef.current += 1;
      const currentSession = connectionSessionRef.current;
      console.log(`🚀 yeni bağlantı session başladı: ${currentSession}`);
      appendVoiceLog(`${channel}: join session ${currentSession}`);
      setLocalMicDebug((prev) => ({ ...prev, permission: "pending", lastError: undefined }));
      
      const stream = await getLocalAudioStream(audioSettings);
      if (currentSession !== connectionSessionRef.current) {
        stopMediaStream(stream);
        return;
      }
      
      if (!stream) throw new Error("Mikrofon alınamadı");
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) throw new Error("Local audio track yok");
      audioTracks.forEach((track) => {
        track.enabled = true;
        track.onended = () => {
          appendVoiceLog("local mic track ended");
          refreshLocalMicDebug(localStreamRef.current, { lastError: "Local mic track ended" });
        };
        track.onmute = () => {
          appendVoiceLog("local mic track muted");
          refreshLocalMicDebug(localStreamRef.current, { lastError: "Local mic track muted" });
        };
        track.onunmute = () => {
          appendVoiceLog("local mic track unmuted");
          refreshLocalMicDebug(localStreamRef.current, { lastError: undefined });
        };
      });
      localStreamRef.current = stream;
      refreshLocalMicDebug(stream, { permission: "granted", lastError: undefined });
      startLocalSpeakingAnalyser(stream);
      setJoinedVoiceChannel(channel);
      setIsMuted(false);
      setIsDeafened(false);
      playSoundEffect('join');
    } catch (error) {
      console.error("❌ Kanala katılma hatası:", error);
      setLocalMicDebug((prev) => ({
        ...prev,
        permission: error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : prev.permission === "pending" ? "unknown" : prev.permission,
        lastError: error instanceof Error ? error.message : String(error),
      }));
      toast({ variant: "destructive", title: "Hata", description: "Mikrofon erişimi sağlanamadı." });
    }
  }, [joinedVoiceChannel, handleLeaveVoiceChannel, audioSettings, db, userId, playSoundEffect, toast, cleanupStalePresence, appendVoiceLog, refreshLocalMicDebug, startLocalSpeakingAnalyser]);

  useEffect(() => {
    const sessionId = connectionSessionRef.current;
    if (isCleaningUpRef.current || !joinedVoiceChannel || !localStreamRef.current || sessionId !== connectionSessionRef.current) return;

    const handlePeerSetup = async (remoteUser: ActiveVoicePresence) => {
      const targetId = remoteUser.userId;
      if (!targetId || targetId === userId) return;
      if (pcsRef.current[targetId] && pcsRef.current[targetId].signalingState !== "closed") return;
      if (pcsRef.current[targetId]) cleanupPeer(targetId);

      const callId = [userId, targetId].sort().join('_');
      const isOfferer = userId === [userId, targetId].sort()[0];
      const callSessionId = isOfferer ? `${connectionSessionRef.current}-${callId}-${Date.now()}` : undefined;
      
      console.log(`📡 peer oluşturuldu: ${targetId} (isOfferer: ${isOfferer}, callId: ${callId})`);
      
      const pc = createPeerConnection();
      if (!pc) return;
      pcsRef.current[targetId] = pc;
      peerStatesRef.current[targetId] = {
        callId,
        isOfferer,
        callSessionId,
        pendingIce: [],
        pendingCandidateDocs: [],
        processedIce: new Set<string>(),
        hasRemoteDescription: false,
        reconnectAttempts: 0,
        status: "new",
      };
      syncPeerDebug(targetId);

      addLocalTracks(pc, localStreamRef.current!);
      updatePeerDebug(targetId, {
        localTrackCount: pc.getSenders().filter((sender) => sender.track?.kind === "audio").length,
        signalingState: pc.signalingState,
        iceState: pc.iceConnectionState,
        audioPlayStatus: "idle",
      });
      peerStatesRef.current[targetId].connectionTimer = setTimeout(() => {
        const latest = peerStatesRef.current[targetId];
        const latestPc = pcsRef.current[targetId];
        if (!latest || !latestPc || latest.status === "connected" || latest.status === "closed") return;
        updatePeerDebug(targetId, {
          timedOut: true,
          needsTurnHint: true,
          iceState: latestPc.iceConnectionState,
          signalingState: latestPc.signalingState,
          lastError: "15sn icinde baglanti kurulamadi. Farkli internet/NAT icin TURN gerekebilir.",
        });
        appendVoiceLog(`${targetId}: 15sn timeout, TURN gerekebilir`);
        requestReconnect();
      }, 15000);

      pc.onicecandidate = (event) => {
        if (event.candidate && db && joinedVoiceChannel && sessionId === connectionSessionRef.current) {
          const candsRef = collection(db, "voiceChannels", joinedVoiceChannel, "calls", callId, "candidates");
          const peerState = peerStatesRef.current[targetId];
          addDocumentNonBlocking(candsRef, { userId, callSessionId: peerState?.callSessionId ?? null, candidate: event.candidate.toJSON(), createdAt: serverTimestamp() });
          appendVoiceLog(`${targetId}: local ICE yazildi`);
        } else if (!event.candidate) {
          appendVoiceLog(`${targetId}: ICE gathering tamamlandi`);
        }
      };

      pc.ontrack = (event) => {
        if (sessionId !== connectionSessionRef.current) return;
        appendVoiceLog(`${targetId}: remote track geldi (${event.track.kind})`);
        if (!remoteAudiosRef.current[targetId]) {
          const audio = document.createElement("audio");
          audio.autoplay = true;
          audio.controls = false;
          audio.preload = "auto";
          (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
          audio.dataset.remoteUserId = targetId;
          audio.style.display = "none";
          document.body.appendChild(audio);
          remoteAudiosRef.current[targetId] = audio;
        }
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        event.track.onmute = () => {
          appendVoiceLog(`${targetId}: remote track muted`);
          updatePeerDebug(targetId, { lastError: "Remote audio track muted" });
        };
        event.track.onunmute = () => {
          appendVoiceLog(`${targetId}: remote track unmuted`);
          updatePeerDebug(targetId, { lastError: undefined });
        };
        event.track.onended = () => {
          appendVoiceLog(`${targetId}: remote track ended`);
          updatePeerDebug(targetId, { lastError: "Remote audio track ended" });
        };
        remoteAudiosRef.current[targetId].srcObject = remoteStream;
        startRemoteSpeakingAnalyser(targetId, remoteStream);
        updatePeerDebug(targetId, {
          remoteTrackCount: remoteStream.getAudioTracks().length,
          signalingState: pc.signalingState,
          iceState: pc.iceConnectionState,
        });
        void attemptRemoteAudioPlay(targetId, "ontrack");
      };

      const callDocRef = doc(db!, "voiceChannels", joinedVoiceChannel, "calls", callId);
      const candidatesRef = collection(db!, "voiceChannels", joinedVoiceChannel, "calls", callId, "candidates");
      const requestReconnect = () => {
        const peerState = peerStatesRef.current[targetId];
        if (!peerState || peerState.reconnectTimer || peerState.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
        peerState.reconnectAttempts += 1;
        syncPeerDebug(targetId);
        const delay = peerState.status === "failed" ? 500 : 2500 + peerState.reconnectAttempts * 1000;
        peerState.reconnectTimer = setTimeout(async () => {
          const latestState = peerStatesRef.current[targetId];
          if (!latestState || sessionId !== connectionSessionRef.current) return;
          latestState.reconnectTimer = undefined;
          if (latestState.status === "connected" || latestState.status === "closed") return;

          if (!latestState.isOfferer) {
            setDocumentNonBlocking(callDocRef, {
              reconnectRequestedBy: userId,
              reconnectRequestedAt: serverTimestamp(),
            }, { merge: true });
            appendVoiceLog(`${targetId}: reconnect offer istendi`);
            return;
          }

          if (pc.signalingState !== "stable") {
            appendVoiceLog(`${targetId}: reconnect ertelendi (${pc.signalingState})`);
            requestReconnect();
            return;
          }

          const nextCallSessionId = `${connectionSessionRef.current}-${callId}-${Date.now()}`;
          latestState.callSessionId = nextCallSessionId;
          latestState.hasRemoteDescription = false;
          const offer = await createOffer(pc, { iceRestart: true });
          if (offer && sessionId === connectionSessionRef.current) {
            latestState.handledAnswerSessionId = undefined;
            setDocumentNonBlocking(callDocRef, {
              callId,
              callSessionId: nextCallSessionId,
              offererId: userId,
              answererId: targetId,
              offer: { type: offer.type, sdp: offer.sdp },
              answer: null,
              reconnectRequestedBy: null,
              createdAt: serverTimestamp(),
            }, { merge: true });
            appendVoiceLog(`${targetId}: ICE restart offer gönderildi`);
            syncPeerDebug(targetId);
          }
        }, delay);
      };

      pc.onconnectionstatechange = () => {
        const nextState = pc.connectionState as PeerConnectionStatus;
        setPeerStatus(targetId, nextState);
        updatePeerDebug(targetId, {
          signalingState: pc.signalingState,
          iceState: pc.iceConnectionState,
          needsTurnHint: nextState === "failed" ? true : undefined,
          lastError: nextState === "failed" ? "Peer connection failed. TURN gerekebilir." : undefined,
        });
        if (nextState === "disconnected" || nextState === "failed") {
          requestReconnect();
        }
      };

      pc.oniceconnectionstatechange = () => {
        const nextState = pc.iceConnectionState;
        updatePeerDebug(targetId, {
          iceState: nextState,
          signalingState: pc.signalingState,
          needsTurnHint: nextState === "failed" ? true : undefined,
          lastError: nextState === "failed" ? "ICE failed. STUN yeterli olmayabilir, TURN gerekebilir." : undefined,
        });
        if (nextState === "checking") setPeerStatus(targetId, "connecting");
        if (nextState === "connected" || nextState === "completed") setPeerStatus(targetId, "connected");
        if (nextState === "disconnected") {
          setPeerStatus(targetId, "disconnected");
          requestReconnect();
        }
        if (nextState === "failed") {
          setPeerStatus(targetId, "failed");
          requestReconnect();
        }
        if (nextState === "closed") setPeerStatus(targetId, "closed");
      };

      const flushPendingIce = async () => {
        const peerState = peerStatesRef.current[targetId];
        if (!peerState || !pc.remoteDescription) return;
        const pending = peerState.pendingIce.splice(0);
        for (const candidate of pending) {
          await addIceCandidate(pc, candidate);
        }
      };
      const processQueuedCandidateDocs = () => {
        const peerState = peerStatesRef.current[targetId];
        if (!peerState?.callSessionId) return;
        const remaining = peerState.pendingCandidateDocs.filter((candidateDoc) => {
          if (candidateDoc.callSessionId !== peerState.callSessionId) return false;
          peerState.processedIce.add(candidateDoc.id);
          if (pc.remoteDescription) {
            void addIceCandidate(pc, candidateDoc.candidate);
          } else {
            peerState.pendingIce.push(candidateDoc.candidate);
          }
          return false;
        });
        peerState.pendingCandidateDocs = remaining;
      };

      const unsub = onSnapshot(callDocRef, async (snap) => {
        if (sessionId !== connectionSessionRef.current || !snap.exists()) return;
        const data = snap.data();
        const peerState = peerStatesRef.current[targetId];
        if (!peerState) return;
        const incomingCallSessionId = typeof data.callSessionId === "string" ? data.callSessionId : undefined;
        if (incomingCallSessionId) {
          peerState.callSessionId = incomingCallSessionId;
          processQueuedCandidateDocs();
          syncPeerDebug(targetId);
        }
        
        try {
          if (isOfferer) {
            const reconnectRequestKey = data.reconnectRequestedAt?.toMillis?.()
              ? `${data.reconnectRequestedBy}:${data.reconnectRequestedAt.toMillis()}`
              : undefined;
            if (
              data.reconnectRequestedBy === targetId &&
              reconnectRequestKey &&
              peerState.handledReconnectRequestKey !== reconnectRequestKey &&
              peerState.reconnectAttempts < MAX_RECONNECT_ATTEMPTS &&
              pc.signalingState === "stable"
            ) {
              peerState.handledReconnectRequestKey = reconnectRequestKey;
              peerState.reconnectAttempts += 1;
              const nextCallSessionId = `${connectionSessionRef.current}-${callId}-${Date.now()}`;
              peerState.callSessionId = nextCallSessionId;
              peerState.hasRemoteDescription = false;
              const offer = await createOffer(pc, { iceRestart: true });
              if (offer && sessionId === connectionSessionRef.current) {
                peerState.handledAnswerSessionId = undefined;
                setDocumentNonBlocking(callDocRef, {
                  callId,
                  callSessionId: nextCallSessionId,
                  offererId: userId,
                  answererId: targetId,
                  offer: { type: offer.type, sdp: offer.sdp },
                  answer: null,
                  reconnectRequestedBy: null,
                  createdAt: serverTimestamp(),
                }, { merge: true });
                appendVoiceLog(`${targetId}: reconnect request için ICE restart`);
                syncPeerDebug(targetId);
              }
            }

            if (data.answer && incomingCallSessionId && peerState.handledAnswerSessionId !== incomingCallSessionId && pc.signalingState === "have-local-offer") {
              await setRemoteDescription(pc, data.answer);
              peerState.hasRemoteDescription = !!pc.remoteDescription;
              peerState.handledAnswerSessionId = incomingCallSessionId;
              appendVoiceLog(`${targetId}: remote answer set`);
              updatePeerDebug(targetId, { signalingState: pc.signalingState, iceState: pc.iceConnectionState });
              await flushPendingIce();
              syncPeerDebug(targetId);
            }
          } else {
            if (data.offer && incomingCallSessionId && peerState.handledOfferSessionId !== incomingCallSessionId && pc.signalingState === "stable") {
              const answer = await createAnswer(pc, data.offer);
              peerState.hasRemoteDescription = !!pc.remoteDescription;
              peerState.handledOfferSessionId = incomingCallSessionId;
              appendVoiceLog(`${targetId}: remote offer set`);
              updatePeerDebug(targetId, { signalingState: pc.signalingState, iceState: pc.iceConnectionState });
              await flushPendingIce();
              if (answer && sessionId === connectionSessionRef.current) {
                setDocumentNonBlocking(callDocRef, { answer: { type: answer.type, sdp: answer.sdp }, answererId: userId }, { merge: true });
                appendVoiceLog(`${targetId}: answer gönderildi`);
                syncPeerDebug(targetId);
              }
            }
          }
        } catch (err) {
          appendVoiceLog(`${targetId}: signaling hata`);
        }
      });

      const unsubCand = onSnapshot(candidatesRef, (snap) => {
        if (sessionId !== connectionSessionRef.current) return;
        const peerState = peerStatesRef.current[targetId];
        if (!peerState) return;
        snap.docChanges().forEach(change => {
          const candidateData = change.doc.data();
          if (
            change.type === "added" &&
            candidateData.userId !== userId &&
            !peerState.processedIce.has(change.doc.id)
          ) {
          const candidate = candidateData.candidate as RTCIceCandidateInit;
          const candidateSessionId = typeof candidateData.callSessionId === "string" ? candidateData.callSessionId : undefined;
          if (!peerState.callSessionId) {
            peerState.pendingCandidateDocs.push({ id: change.doc.id, callSessionId: candidateSessionId, candidate });
            appendVoiceLog(`${targetId}: remote ICE queued (session bekleniyor)`);
            return;
          }
          if (candidateSessionId !== peerState.callSessionId) return;
          peerState.processedIce.add(change.doc.id);
          if (pc.remoteDescription) {
            void addIceCandidate(pc, candidate);
            appendVoiceLog(`${targetId}: remote ICE eklendi`);
          } else {
            peerState.pendingIce.push(candidate);
            appendVoiceLog(`${targetId}: remote ICE buffered (remoteDescription yok)`);
          }
        }
      });
      });

      signalingUnsubsRef.current[targetId] = () => { unsub(); unsubCand(); };

      if (isOfferer) {
        const offer = await createOffer(pc);
        if (offer && sessionId === connectionSessionRef.current) {
          setDocumentNonBlocking(callDocRef, { callId, callSessionId, offererId: userId, answererId: targetId, offer: { type: offer.type, sdp: offer.sdp }, answer: null, createdAt: serverTimestamp() }, { merge: true });
          appendVoiceLog(`${targetId}: offer gönderildi`);
          syncPeerDebug(targetId);
        }
      }
    };

    activeUsers.forEach(handlePeerSetup);

    const activePeerIds = new Set(activeUsers.map((u) => u.userId).filter(Boolean));
    Object.keys(pcsRef.current).forEach(pid => {
      if (!activePeerIds.has(pid)) {
        cleanupPeer(pid);
      }
    });

  }, [activeUsers, joinedVoiceChannel, cleanupPeer, db, userId, appendVoiceLog, attemptRemoteAudioPlay, setPeerStatus, syncPeerDebug, startRemoteSpeakingAnalyser, updatePeerDebug]);

  useEffect(() => {
    if (!joinedVoiceChannel) return;
    let cancelled = false;

    const inspectPeerQuality = async () => {
      const updates: Record<string, ConnectionQuality> = {};
      const entries = Object.entries(pcsRef.current);

      await Promise.all(entries.map(async ([targetId, pc]) => {
        const state = peerStatesRef.current[targetId]?.status;
        if (state === "failed" || state === "disconnected" || state === "connecting") {
          updates[targetId] = "reconnecting";
          return;
        }
        if (state !== "connected") {
          updates[targetId] = "good";
          return;
        }

        try {
          const stats = await pc.getStats();
          let jitter = 0;
          let roundTripTime = 0;
          let packetsLost = 0;
          let packetsTotal = 0;

          stats.forEach((report) => {
            const stat = report as RTCStats & {
              kind?: string;
              mediaType?: string;
              jitter?: number;
              roundTripTime?: number;
              packetsLost?: number;
              packetsReceived?: number;
              packetsSent?: number;
            };
            const isAudio = stat.kind === "audio" || stat.mediaType === "audio";
            if (!isAudio) return;
            if (typeof stat.jitter === "number") jitter = Math.max(jitter, stat.jitter);
            if (typeof stat.roundTripTime === "number") roundTripTime = Math.max(roundTripTime, stat.roundTripTime);
            if (typeof stat.packetsLost === "number") packetsLost += Math.max(0, stat.packetsLost);
            if (typeof stat.packetsReceived === "number") packetsTotal += Math.max(0, stat.packetsReceived);
            if (typeof stat.packetsSent === "number") packetsTotal += Math.max(0, stat.packetsSent);
          });

          const lossRatio = packetsTotal > 0 ? packetsLost / Math.max(1, packetsTotal + packetsLost) : 0;
          updates[targetId] =
            lossRatio > 0.08 || jitter > 0.08 || roundTripTime > 0.45 ? "poor" :
            lossRatio > 0.03 || jitter > 0.04 || roundTripTime > 0.22 ? "good" :
            "excellent";
        } catch {
          updates[targetId] = "good";
        }
      }));

      if (cancelled) return;
      setPeerQuality((prev) => {
        const activeIds = new Set(Object.keys(pcsRef.current));
        let changed = false;
        const next: Record<string, ConnectionQuality> = {};

        activeIds.forEach((id) => {
          next[id] = updates[id] ?? prev[id] ?? "good";
          if (prev[id] !== next[id]) changed = true;
        });
        if (Object.keys(prev).some((id) => !activeIds.has(id))) changed = true;
        return changed ? next : prev;
      });
      setPeerDebug((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(updates).forEach(([targetId, quality]) => {
          if (next[targetId]?.quality !== quality) {
            next[targetId] = { ...(next[targetId] ?? { status: "new", attempts: 0 }), quality };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };

    void inspectPeerQuality();
    const timer = setInterval(() => void inspectPeerQuality(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [joinedVoiceChannel]);

  useEffect(() => {
    if (isCleaningUpRef.current || !db || !joinedVoiceChannel || !userId) return;
    const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
    const update = () => {
      if (isCleaningUpRef.current || !joinedVoiceChannel) return;
      setDocumentNonBlocking(presenceRef, {
        userId, displayName: userName, voiceChannelId: joinedVoiceChannel,
        lastSeen: new Date().toISOString(), isMuted, isDeafened, id: userId,
        isSharingScreen: isScreenSharing, isCameraOn: isCameraOn, isSpeaking: isSpeaking,
      }, { merge: true });
    };
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [db, joinedVoiceChannel, userId, userName, isMuted, isDeafened, isScreenSharing, isCameraOn, isSpeaking]);

  useEffect(() => {
    if (!joinedVoiceChannel || activeUsers.length <= MAX_VOICE_USERS) return;
    const allowedUserIds = activeUsers
      .slice()
      .sort((a, b) => a.lastSeen.localeCompare(b.lastSeen) || a.userId.localeCompare(b.userId))
      .slice(0, MAX_VOICE_USERS)
      .map((u) => u.userId);
    if (!allowedUserIds.includes(userId)) {
      toast({
        variant: "destructive",
        title: "Kanal Dolu",
        description: "Bu ses kanalı dolu. Maksimum 5 kişi katılabilir.",
      });
      void handleLeaveVoiceChannel();
    }
  }, [activeUsers, joinedVoiceChannel, userId, toast, handleLeaveVoiceChannel]);

  useEffect(() => {
    if (!joinedVoiceChannel) return;
    const timer = setInterval(() => {
      void cleanupStalePresence(joinedVoiceChannel);
    }, 10000);
    return () => clearInterval(timer);
  }, [joinedVoiceChannel, cleanupStalePresence]);

  useEffect(() => {
    if (!db || !joinedVoiceChannel || !userId) return;
    const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
    const clearPresence = () => {
      void deleteDoc(presenceRef);
    };
    window.addEventListener("pagehide", clearPresence);
    window.addEventListener("beforeunload", clearPresence);
    return () => {
      window.removeEventListener("pagehide", clearPresence);
      window.removeEventListener("beforeunload", clearPresence);
    };
  }, [db, joinedVoiceChannel, userId]);

  const handleEnableRemoteAudio = useCallback(() => {
    Object.keys(remoteAudiosRef.current).forEach((remoteUserId) => {
      void attemptRemoteAudioPlay(remoteUserId, "user-unlock");
    });
  }, [attemptRemoteAudioPlay]);

  useEffect(() => {
    if (blockedAudioUserIds.length === 0) return;
    const unlock = () => {
      handleEnableRemoteAudio();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [blockedAudioUserIds.length, handleEnableRemoteAudio]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((current) => {
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = current;
      });
      return !current;
    });
  }, []);

  const handleToggleDeafen = useCallback(() => {
    setIsDeafened((current) => {
      Object.values(remoteAudiosRef.current).forEach((audio) => {
        audio.muted = !current;
      });
      return !current;
    });
  }, []);

  const channelDescription = activeView.type === "text"
    ? "Genel sohbet, duyurular ve ekip mesajlari"
    : `${activeUsers.length}/${MAX_VOICE_USERS} kisi seste`;

  const channelQuality: ConnectionQuality = joinedVoiceChannel
    ? Object.values(peerQuality).includes("reconnecting") ? "reconnecting" :
      Object.values(peerQuality).includes("poor") ? "poor" :
      Object.values(peerQuality).includes("good") ? "good" :
      "excellent"
    : "excellent";

  return (
    <div className="relative flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(124,92,255,0.16),transparent_34%),linear-gradient(135deg,#121019_0%,#191522_42%,#11131c_100%)] text-foreground">
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Sidebar kapat"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <RoomSidebar
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-300 md:static md:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        rooms={rooms} voiceChannels={voiceChannels} activeRoom={activeView.id}
        onRoomSelect={(id) => { setActiveView({ type: 'text', id }); setIsSidebarOpen(false); }}
        userName={userName} userId={userId} userRole={userRole} onLogout={onLogout}
        joinedVoiceChannel={joinedVoiceChannel} joinedVoiceUserCount={activeUsers.length} onJoinVoice={(channel) => { void handleJoinVoiceChannel(channel); setIsSidebarOpen(false); }} onLeaveVoice={handleLeaveVoiceChannel}
        isMuted={isMuted} onToggleMute={handleToggleMute}
        isDeafened={isDeafened} onToggleDeafen={handleToggleDeafen}
        isSpeaking={isSpeaking} isScreenSharing={isScreenSharing} onToggleScreenShare={() => {}}
        isCameraOn={isCameraOn} onToggleCamera={() => {}}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAdminPanel={() => setIsAdminPanelOpen(true)}
        peerQuality={peerQuality}
        userVolumes={userVolumes} onVolumeChange={handleVolumeChange} onKickUser={() => {}}
        onAddChannel={() => {}} onDeleteChannel={() => {}}
      />

      <main className="min-w-0 flex-1 flex flex-col bg-[#17151f]/80">
        <header className="h-[72px] shrink-0 border-b border-white/8 bg-[#17151f]/75 px-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:px-5">
          <div className="flex h-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Kanallari ac"
                className="h-10 w-10 rounded-xl border border-white/10 bg-white/[0.04] text-white md:hidden"
                onClick={() => setIsSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] shadow-inner">
                {activeView.type === "text" ? <Hash className="h-5 w-5 text-indigo-200" /> : <Volume2 className="h-5 w-5 text-emerald-300" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">{activeView.id}</h1>
                  <span className="hidden rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/55 sm:inline-flex">
                    {activeView.type === "text" ? "Text" : "Voice"}
                  </span>
                </div>
                <p className="truncate text-xs text-white/45">{channelDescription}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 sm:flex">
                <span className={cn(
                  "h-2 w-2 rounded-full",
                  channelQuality === "reconnecting" ? "animate-pulse bg-amber-300" :
                  channelQuality === "poor" ? "bg-red-300" :
                  channelQuality === "good" ? "bg-sky-300" :
                  "bg-emerald-300"
                )} />
                <Wifi className="h-3.5 w-3.5" />
                {joinedVoiceChannel ? channelQuality : "Online"}
              </div>
              <Button variant="ghost" size="icon" className="hidden h-10 w-10 rounded-xl text-white/55 hover:bg-white/[0.07] hover:text-white sm:inline-flex">
                <Search className="h-4 w-4" />
              </Button>
              {joinedVoiceChannel && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-10 w-10 rounded-xl border border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white",
                    isVoiceDebugOpen && "border-indigo-400/40 bg-indigo-500/15 text-indigo-100"
                  )}
                  onClick={() => setIsVoiceDebugOpen((v) => !v)}
                  aria-label="Voice debug"
                >
                  <Bug className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </header>

        {activeView.type === 'text' ? (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-indigo-500/8 to-transparent" />
            <ScrollArea className="flex-1">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-5 pb-28 sm:px-6">
                {!messages?.length && (
                  <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center shadow-2xl shadow-black/20 backdrop-blur">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-100">
                      <Hash className="h-5 w-5" />
                    </div>
                    <h2 className="text-base font-semibold text-white">#{activeView.id} kanali hazir</h2>
                    <p className="mt-1 text-sm text-white/45">Ilk mesaji gonder ve sohbeti baslat.</p>
                  </div>
                )}
                {messages?.map((msg) => {
                  const initial = (msg.displayName || "?").charAt(0).toUpperCase();
                  return (
                    <div key={msg.id} className="group flex gap-3 rounded-2xl px-2 py-2 transition-all duration-200 hover:bg-white/[0.045] sm:px-3">
                      <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-sm font-bold text-white shadow-lg shadow-indigo-950/30">
                        {initial}
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#17151f] bg-emerald-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-semibold text-indigo-100">{msg.displayName}</span>
                          <span className="text-[11px] text-white/35">{msg.createdAt?.toDate?.().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '...'}</span>
                        </div>
                        <p className="mt-1 break-words text-sm leading-6 text-white/78">{msg.text}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>
            <form onSubmit={handleSendMessage} className="pointer-events-none absolute inset-x-0 bottom-0 shrink-0 bg-gradient-to-t from-[#17151f] via-[#17151f]/95 to-transparent px-3 pb-4 pt-10 sm:px-6">
              <div className="pointer-events-auto mx-auto flex w-full max-w-5xl items-center gap-2 rounded-2xl border border-white/10 bg-[#23202d]/95 p-2 shadow-2xl shadow-black/35 backdrop-blur-xl">
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-xl text-white/45 hover:bg-white/[0.07] hover:text-white" aria-label="Dosya ekle">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Input
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder={`#${activeView.id} kanalina mesaj gonder`}
                  className="h-11 min-w-0 border-0 bg-transparent px-1 text-sm text-white shadow-none placeholder:text-white/35 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button type="button" variant="ghost" size="icon" className="hidden h-10 w-10 shrink-0 rounded-xl text-white/45 hover:bg-white/[0.07] hover:text-white sm:inline-flex" aria-label="Emoji">
                  <Smile className="h-4 w-4" />
                </Button>
                <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-950/30 hover:from-indigo-400 hover:to-violet-500" disabled={!messageText.trim()} aria-label="Mesaj gonder">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(79,70,229,0.18),transparent_34%),#11131b] p-3 pb-28 sm:p-6 sm:pb-28">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Volume2 className="h-4 w-4 text-emerald-300" />
                  {activeView.id}
                </div>
                <p className="mt-1 text-xs text-white/45">Dusuk gecikmeli ses odasi</p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-white/65">
                <Users className="h-3.5 w-3.5" />
                {activeUsers.length}/{MAX_VOICE_USERS}
              </div>
            </div>
             <div className={cn(
                "grid min-h-0 w-full flex-1 gap-3 sm:gap-4",
                activeUsers.length <= 1 ? "grid-cols-1" : 
                activeUsers.length === 2 ? "grid-cols-1 sm:grid-cols-2" :
                "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
              )}>
                {activeUsers.map((u) => {
                  const userSpeaking = u.userId === userId ? isSpeaking : Boolean(u.isSpeaking || remoteSpeaking[u.userId]);
                  const quality = u.userId === userId ? "excellent" : (peerQuality[u.userId] ?? "good");
                  return (
                  <div key={u.id} className={cn(
                    "voice-card-enter relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-3xl border bg-[#232532]/90 shadow-2xl shadow-black/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-indigo-950/20",
                    "before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_50%_20%,rgba(124,92,255,0.22),transparent_42%)] before:opacity-80",
                    userSpeaking ? "border-emerald-400/70 shadow-[0_0_35px_rgba(52,211,153,0.18)]" : "border-white/10 hover:border-white/18"
                  )}>
                    <div className={cn(
                      "relative z-10 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-indigo-400 via-violet-500 to-fuchsia-500 text-3xl font-bold text-white shadow-2xl shadow-indigo-950/40 transition-all",
                      userSpeaking && "speaking-pulse ring-4 ring-emerald-400/55 ring-offset-4 ring-offset-[#232532]"
                    )}>
                      {u.displayName.charAt(0).toUpperCase()}
                      <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-[3px] border-[#232532] bg-emerald-400" />
                    </div>
                    <div className={cn(
                      "absolute right-4 top-4 z-10 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
                      quality === "excellent" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" :
                      quality === "good" ? "border-sky-300/20 bg-sky-400/10 text-sky-200" :
                      quality === "poor" ? "border-red-300/20 bg-red-400/10 text-red-200" :
                      "border-amber-300/20 bg-amber-400/10 text-amber-200"
                    )}>
                      {quality}
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/35 px-3 py-2.5 backdrop-blur-xl">
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">{u.displayName}</span>
                        <span className={cn("text-[11px]", userSpeaking ? "text-emerald-300" : "text-white/40")}>
                          {userSpeaking ? "Konusuyor" : "Online"}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {u.isDeafened && (
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/15 text-red-200">
                            <Headphones className="h-4 w-4" />
                          </div>
                        )}
                        <div className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-xl border",
                          u.isMuted ? "border-red-400/30 bg-red-500/15 text-red-200" : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                        )}>
                          {u.isMuted ? <MicOff className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
                {activeUsers.length === 0 && (
                  <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 bg-white/[0.035] text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-500/15 text-indigo-100">
                      <Volume2 className="h-7 w-7" />
                    </div>
                    <h2 className="text-lg font-semibold text-white">Bu ses kanali bos</h2>
                    <p className="mt-1 max-w-sm text-sm text-white/45">Katildiginda diger kullanicilar burada net durum kartlariyla gorunecek.</p>
                  </div>
                )}
              </div>
          </div>
        )}
      </main>

      {joinedVoiceChannel && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3 sm:bottom-5">
          <div className="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-3xl border border-white/10 bg-[#15131d]/82 p-2.5 shadow-2xl shadow-black/35 backdrop-blur-2xl">
            <div className="min-w-0 px-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.75)]" />
                Live voice
              </div>
              <div className="mt-0.5 truncate text-[11px] text-white/42">{joinedVoiceChannel} · {channelQuality}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Mikrofonu ac/kapat"
                className={cn(
                  "h-11 w-11 rounded-2xl border border-white/10 bg-white/[0.045] text-white/65 transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:text-white",
                  isMuted && "border-red-300/25 bg-red-500/14 text-red-200"
                )}
                onClick={handleToggleMute}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Kulakligi ac/kapat"
                className={cn(
                  "h-11 w-11 rounded-2xl border border-white/10 bg-white/[0.045] text-white/65 transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:text-white",
                  isDeafened && "border-red-300/25 bg-red-500/14 text-red-200"
                )}
                onClick={handleToggleDeafen}
              >
                <Headphones className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ses ayarlari"
                className="h-11 w-11 rounded-2xl border border-white/10 bg-white/[0.045] text-white/65 transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sesten ayril"
                className="h-11 w-11 rounded-2xl border border-red-300/25 bg-red-500/14 text-red-200 transition-all hover:-translate-y-0.5 hover:bg-red-500/22 hover:text-red-100"
                onClick={handleLeaveVoiceChannel}
              >
                <PhoneOff className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {blockedAudioUserIds.length > 0 && (
        <div className={cn(
          "absolute left-1/2 z-30 -translate-x-1/2 rounded-md border border-white/10 bg-[#1E1F22] p-3 shadow-xl",
          joinedVoiceChannel ? "bottom-24" : "bottom-4"
        )}>
          <Button size="sm" className="gap-2" onClick={handleEnableRemoteAudio}>
            <Volume2 className="w-4 h-4" />
            Sesi etkinleştir
          </Button>
        </div>
      )}

      {isVoiceDebugOpen && (
        <div className="absolute bottom-4 right-4 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-white/10 bg-[#1E1F22] p-3 text-xs shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold text-foreground">Voice Debug</div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsVoiceDebugOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mb-3 rounded bg-white/5 p-2 text-muted-foreground">
            <div className="mb-1 font-semibold text-foreground">Local mic</div>
            <div className="grid grid-cols-2 gap-1">
              <span>permission</span><span className="text-right">{localMicDebug.permission}</span>
              <span>tracks</span><span className="text-right">{localMicDebug.enabledCount}/{localMicDebug.trackCount}</span>
            </div>
            {localMicDebug.lastError && <div className="mt-1 text-red-300">{localMicDebug.lastError}</div>}
          </div>
          <div className="space-y-1">
            {Object.entries(peerDebug).length === 0 ? (
              <div className="text-muted-foreground">Peer yok</div>
            ) : Object.entries(peerDebug).map(([remoteUserId, info]) => (
              <div key={remoteUserId} className="rounded bg-white/5 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{remoteUserId}</span>
                  <span className={cn(
                    "shrink-0 font-semibold",
                    info.status === "connected" ? "text-green-400" :
                    info.status === "failed" ? "text-red-400" :
                    info.status === "disconnected" ? "text-yellow-400" : "text-muted-foreground"
                  )}>{info.status} ({info.attempts})</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>ice</span><span className="truncate text-right">{info.iceState ?? "-"}</span>
                  <span>signaling</span><span className="truncate text-right">{info.signalingState ?? "-"}</span>
                  <span>tracks</span><span className="text-right">{info.localTrackCount ?? 0}/{info.remoteTrackCount ?? 0}</span>
                  <span>audio</span><span className="truncate text-right">{info.audioPlayStatus ?? "idle"}</span>
                  <span>quality</span><span className="truncate text-right">{info.quality ?? "-"}</span>
                </div>
                {info.needsTurnHint && (
                  <div className="mt-1 rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">
                    TURN gerekebilir: STUN/NAT baglantisi kuramadi.
                  </div>
                )}
                {info.lastError && <div className="mt-1 text-[11px] text-red-300">{info.lastError}</div>}
              </div>
            ))}
          </div>
          <ScrollArea className="mt-3 h-32 rounded bg-black/20 p-2">
            <div className="space-y-1 text-muted-foreground">
              {voiceDebugLogs.length === 0 ? <div>Log yok</div> : voiceDebugLogs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
            </div>
          </ScrollArea>
        </div>
      )}

      <AudioSettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} settings={audioSettings} onSettingsChange={handleSettingsChange} />
      <AdminPanel isOpen={isAdminPanelOpen} onOpenChange={setIsAdminPanelOpen} userRole={userRole} />
    </div>
  );
}
