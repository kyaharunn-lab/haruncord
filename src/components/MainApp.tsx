
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { RoomSidebar } from "./RoomSidebar";
import { Hash, MessageSquare, Plus, Trash2, Monitor, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useMemoFirebase, useCollection, useDoc } from "@/firebase";
import { doc, collection, serverTimestamp, getDocs, query, where, writeBatch, orderBy, limit, setDoc, deleteDoc } from "firebase/firestore";
import {
  setDocumentNonBlocking,
  deleteDocumentNonBlocking,
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
  setAudioOutputDevice,
  type AudioSettings,
} from "@/lib/webrtc";
import { AudioSettingsDialog } from "./AudioSettingsDialog";
import { UserRole } from "@/app/page";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface MainAppProps {
  userName: string;
  userId: string;
  userRole: UserRole;
  onLogout: () => void;
}

export function MainApp({ userName, userId, userRole, onLogout }: MainAppProps) {
  const [activeRoom, setActiveRoom] = useState("Genel");
  const [joinedVoiceChannel, setJoinedVoiceChannel] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddChannelOpen, setIsAddChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<"text" | "voice">("text");
  const [messageText, setMessageText] = useState("");
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});
  const [audioSettings, setAudioSettings] = useState<AudioSettings & { outputDeviceId?: string }>({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    micSensitivity: 0.02,
    deviceId: "default",
    outputDeviceId: "default",
  });

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const processedIceCandidatesRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const db = useFirestore();

  // --- Dinamik Kanallar ---
  const roomsQuery = useMemoFirebase(() => db ? query(collection(db, "textChannels"), limit(20)) : null, [db]);
  const { data: roomsData } = useCollection(roomsQuery);
  const rooms = useMemo(() => roomsData?.map(r => r.id) || ["Genel"], [roomsData]);

  const voiceChannelsQuery = useMemoFirebase(() => db ? query(collection(db, "voiceChannels"), limit(20)) : null, [db]);
  const { data: voiceChannelsData } = useCollection(voiceChannelsQuery);
  const voiceChannels = useMemo(() => voiceChannelsData?.map(v => v.id) || ["Genel Ses"], [voiceChannelsData]);

  // Varsayılan kanalları oluştur (ilk kez açılıyorsa)
  useEffect(() => {
    if (db && roomsData?.length === 0) {
      ["Genel", "Oyun", "Muhabbet"].forEach(id => {
        setDoc(doc(db, "textChannels", id), { createdAt: serverTimestamp() });
      });
    }
    if (db && voiceChannelsData?.length === 0) {
      ["Genel Ses", "Oyun Ses", "Muhabbet Ses"].forEach(id => {
        setDoc(doc(db, "voiceChannels", id), { name: id, createdAt: serverTimestamp() });
      });
    }
  }, [db, roomsData, voiceChannelsData]);

  const handleAddChannel = async () => {
    if (!newChannelName.trim() || !db || userRole !== 'admin') return;
    const cleanName = newChannelName.trim();
    
    try {
      if (newChannelType === "text") {
        await setDoc(doc(db, "textChannels", cleanName), { createdAt: serverTimestamp() });
      } else {
        await setDoc(doc(db, "voiceChannels", cleanName), { name: cleanName, createdAt: serverTimestamp() });
      }
      setIsAddChannelOpen(false);
      setNewChannelName("");
      toast({ title: "Kanal Oluşturuldu", description: `${cleanName} başarıyla eklendi.` });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteChannel = async (id: string, type: "text" | "voice") => {
    if (!db || userRole !== 'admin') return;
    try {
      await deleteDoc(doc(db, type === "text" ? "textChannels" : "voiceChannels", id));
      if (type === "text" && activeRoom === id) setActiveRoom("Genel");
      if (type === "voice" && joinedVoiceChannel === id) handleLeaveVoiceChannel();
      toast({ title: "Kanal Silindi", description: `${id} başarıyla kaldırıldı.` });
    } catch (e) {
      console.error(e);
    }
  };

  // --- Mesajlaşma Mantığı ---
  const messagesQuery = useMemoFirebase(() => {
    if (!db || !activeRoom) return null;
    return query(
      collection(db, "textChannels", activeRoom, "messages"),
      orderBy("createdAt", "asc"),
      limit(50)
    );
  }, [db, activeRoom]);

  const { data: messages } = useCollection(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !db || !activeRoom) return;

    const messagesRef = collection(db, "textChannels", activeRoom, "messages");
    addDocumentNonBlocking(messagesRef, {
      text: messageText.trim(),
      userId,
      displayName: userName,
      createdAt: serverTimestamp(),
    });

    setMessageText("");
  };

  // --- Sesli Sohbet Mantığı (WebRTC) ---
  useEffect(() => {
    const savedAudio = localStorage.getItem("kanka_voice_audio_settings");
    if (savedAudio) {
      try {
        setAudioSettings(prev => ({ ...prev, ...JSON.parse(savedAudio) }));
      } catch (e) { console.error(e); }
    }
    const savedVolumes = localStorage.getItem("kanka_user_volumes");
    if (savedVolumes) {
      try { setUserVolumes(JSON.parse(savedVolumes)); } catch (e) { console.error(e); }
    }
  }, []);

  const handleVolumeChange = useCallback((targetUserId: string, volume: number) => {
    setUserVolumes(prev => {
      const next = { ...prev, [targetUserId]: volume };
      localStorage.setItem("kanka_user_volumes", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSettingsChange = useCallback(async (newSettings: AudioSettings & { outputDeviceId?: string }) => {
    setAudioSettings(newSettings);
    if (joinedVoiceChannel && localStreamRef.current) {
      const oldTracks = localStreamRef.current.getTracks();
      const newStream = await getLocalAudioStream(newSettings);
      if (newStream) {
        oldTracks.forEach(t => t.stop());
        localStreamRef.current = newStream;
        newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const audioSender = senders.find(s => s.track?.kind === 'audio');
          const newTrack = newStream.getAudioTracks()[0];
          if (audioSender && newTrack) audioSender.replaceTrack(newTrack);
        }
      }
    }
  }, [joinedVoiceChannel, isMuted]);

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
      if (type === 'join') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(500, now);
        oscillator.frequency.exponentialRampToValueAtTime(700, now + 0.15);
      } else {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(700, now);
        oscillator.frequency.exponentialRampToValueAtTime(500, now + 0.15);
      }
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (err) {}
  }, []);

  // Lokal Konuşma Analizi
  useEffect(() => {
    if (!localStreamRef.current || isMuted || !joinedVoiceChannel) {
      setIsSpeaking(false);
      return;
    }
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let animationId = 0;
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(localStreamRef.current);
      source.connect(analyser);
      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((total, value) => total + value, 0);
        const threshold = (audioSettings.micSensitivity ?? 0.02) * 255;
        setIsSpeaking((sum / dataArray.length) > threshold);
        animationId = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (err) {}
    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (audioContext) audioContext.close();
    };
  }, [joinedVoiceChannel, isMuted, audioSettings.micSensitivity]);

  const localPresenceRef = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel || !userId) return null;
    return doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
  }, [db, joinedVoiceChannel, userId]);
  const { data: localPresenceData } = useDoc(localPresenceRef);

  useEffect(() => {
    if (localPresenceData?.isKicked && joinedVoiceChannel) {
      handleLeaveVoiceChannel();
      toast({ variant: "destructive", title: "Kanaldan Atıldın", description: "Bir yönetici tarafından ses kanalından çıkarıldın." });
    }
  }, [localPresenceData?.isKicked, joinedVoiceChannel]);

  useEffect(() => {
    if (!db || !joinedVoiceChannel || !userId) return;
    const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
    const updatePresence = () => {
      setDocumentNonBlocking(presenceRef, {
        userId, 
        displayName: userName, 
        voiceChannelId: joinedVoiceChannel,
        lastSeen: new Date().toISOString(), 
        isMuted, 
        id: userId,
        isSharingScreen: isScreenSharing,
      }, { merge: true });
    };
    updatePresence();
    const heartbeat = setInterval(updatePresence, 5000);
    return () => {
      clearInterval(heartbeat);
      deleteDocumentNonBlocking(presenceRef);
    };
  }, [db, joinedVoiceChannel, userId, userName, isMuted, isScreenSharing]);

  const presenceQuery = useMemoFirebase(() => db && joinedVoiceChannel ? collection(db, "voiceChannels", joinedVoiceChannel, "presence") : null, [db, joinedVoiceChannel]);
  const { data: rawChannelUsers } = useCollection(presenceQuery);
  const channelUsers = useMemo(() => {
    if (!rawChannelUsers) return null;
    const now = Date.now();
    return rawChannelUsers.filter(u => u.lastSeen && (now - new Date(u.lastSeen).getTime() < 15000));
  }, [rawChannelUsers]);

  const targetUser = useMemo(() => channelUsers?.find(u => u.userId !== userId) || null, [channelUsers, userId]);

  const callInfo = useMemo(() => {
    if (!targetUser || !userId) return null;
    const ids = [userId, targetUser.userId].sort();
    return { callId: ids.join('_'), offererId: ids[0], answererId: ids[1], isOfferer: userId === ids[0] };
  }, [targetUser, userId]);

  const callDocRef = useMemoFirebase(() => db && joinedVoiceChannel && callInfo ? doc(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId) : null, [db, joinedVoiceChannel, callInfo]);
  const { data: callData } = useDoc(callDocRef);

  const candidatesQuery = useMemoFirebase(() => db && joinedVoiceChannel && callInfo ? collection(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId, "candidates") : null, [db, joinedVoiceChannel, callInfo]);
  const { data: remoteCandidates } = useCollection(candidatesQuery);

  const setupPeerConnection = useCallback(() => {
    const pc = createPeerConnection();
    if (!pc) return null;
    pc.onicecandidate = (event) => {
      if (event.candidate && db && joinedVoiceChannel && callInfo) {
        const candsRef = collection(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId, "candidates");
        addDocumentNonBlocking(candsRef, { userId, candidate: event.candidate.toJSON(), createdAt: serverTimestamp() });
      }
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (event.track.kind === 'audio') {
        if (!remoteAudioRef.current) {
          const audio = document.createElement("audio");
          audio.autoplay = true;
          audio.playsInline = true;
          document.body.appendChild(audio);
          remoteAudioRef.current = audio;
        }
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.muted = isDeafened;
        const targetId = callInfo?.isOfferer ? callInfo.answererId : callInfo?.offererId;
        if (targetId) remoteAudioRef.current.volume = (userVolumes[targetId] ?? 100) / 100;
        remoteAudioRef.current.play().catch(() => {});
      } else if (event.track.kind === 'video') {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(() => {});
          setHasRemoteVideo(true);
        }
      }
    };
    if (localStreamRef.current) addLocalTracks(pc, localStreamRef.current);
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => pc.addTrack(track, screenStreamRef.current!));
    }
    return pc;
  }, [db, joinedVoiceChannel, callInfo, userId, isDeafened, userVolumes]);

  useEffect(() => {
    const handleSignaling = async () => {
      if (!callInfo || !callDocRef || !db) return;
      if (callInfo.isOfferer) {
        if (!peerConnectionRef.current) {
          const pc = setupPeerConnection();
          if (!pc) return;
          peerConnectionRef.current = pc;
          const offer = await createOffer(pc);
          if (offer) setDocumentNonBlocking(callDocRef, { ...callInfo, offer: { type: offer.type, sdp: offer.sdp }, createdAt: serverTimestamp() }, { merge: true });
        }
        if (callData?.answer && peerConnectionRef.current?.signalingState === "have-local-offer") await setRemoteDescription(peerConnectionRef.current, callData.answer);
      } else if (callData?.offer && !peerConnectionRef.current) {
        const pc = setupPeerConnection();
        if (!pc) return;
        peerConnectionRef.current = pc;
        const answer = await createAnswer(pc, callData.offer);
        if (answer) setDocumentNonBlocking(callDocRef, { answer: { type: answer.type, sdp: answer.sdp }, answererId: userId }, { merge: true });
      }
    };
    handleSignaling();
  }, [callInfo, callData, callDocRef, db, setupPeerConnection, userId]);

  useEffect(() => {
    if (!remoteCandidates || !peerConnectionRef.current) return;
    remoteCandidates.forEach(doc => {
      if (doc.userId !== userId && !processedIceCandidatesRef.current.has(doc.id)) {
        addIceCandidate(peerConnectionRef.current!, doc.candidate);
        processedIceCandidatesRef.current.add(doc.id);
      }
    });
  }, [remoteCandidates, userId]);

  const handleLeaveVoiceChannel = useCallback(async () => {
    if (joinedVoiceChannel) playSoundEffect('leave');
    if (peerConnectionRef.current) closePeerConnection(peerConnectionRef.current);
    peerConnectionRef.current = null;
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach(t => t.stop()); screenStreamRef.current = null; }
    if (db && joinedVoiceChannel && userId) {
      deleteDocumentNonBlocking(doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId));
      const q1 = query(collection(db, "voiceChannels", joinedVoiceChannel, "calls"), where("offererId", "==", userId));
      const q2 = query(collection(db, "voiceChannels", joinedVoiceChannel, "calls"), where("answererId", "==", userId));
      const snaps = await Promise.all([getDocs(q1), getDocs(q2)]);
      const batch = writeBatch(db);
      [...snaps[0].docs, ...snaps[1].docs].forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    processedIceCandidatesRef.current.clear();
    setJoinedVoiceChannel(null);
    setIsSpeaking(false);
    setIsScreenSharing(false);
    setHasRemoteVideo(false);
  }, [db, joinedVoiceChannel, userId, playSoundEffect]);

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    if (joinedVoiceChannel === channel) return;
    if (joinedVoiceChannel) await handleLeaveVoiceChannel();
    try {
      const stream = await getLocalAudioStream(audioSettings);
      if (!stream) throw new Error();
      localStreamRef.current = stream;
      setJoinedVoiceChannel(channel);
      setIsMuted(false);
      setIsDeafened(false);
      playSoundEffect('join');
    } catch (error) { toast({ variant: "destructive", title: "Hata", description: "Mikrofon erişimi sağlanamadı." }); }
  }, [joinedVoiceChannel, handleLeaveVoiceChannel, audioSettings, playSoundEffect, toast]);

  const handleToggleScreenShare = async () => {
    if (!joinedVoiceChannel) return;

    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      toast({ title: "Paylaşım Durduruldu", description: "Ekran paylaşımı sonlandırıldı." });
      handleLeaveVoiceChannel().then(() => handleJoinVoiceChannel(joinedVoiceChannel));
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        stream.getVideoTracks()[0].onended = () => handleToggleScreenShare();
        
        if (peerConnectionRef.current) {
          handleLeaveVoiceChannel().then(() => handleJoinVoiceChannel(joinedVoiceChannel));
        }
        
        toast({ title: "Ekran Paylaşılıyor", description: "Ekranınız şu an kanaldaki diğer kişilere aktarılıyor." });
      } catch (err) {
        console.error("Ekran paylaşımı hatası:", err);
      }
    }
  };

  const handleKickUser = useCallback((targetId: string) => {
    if (!db || !joinedVoiceChannel || (userRole !== 'admin' && userRole !== 'mod')) return;
    setDocumentNonBlocking(doc(db, "voiceChannels", joinedVoiceChannel, "presence", targetId), { isKicked: true }, { merge: true });
    toast({ title: "Kullanıcı Atıldı", description: "Kullanıcı ses kanalından çıkarıldı." });
  }, [db, joinedVoiceChannel, toast, userRole]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground relative">
      {/* Oyun Modu Overlay */}
      {joinedVoiceChannel && (
        <div className="absolute top-4 right-4 z-50 pointer-events-none">
          <div className="bg-black/40 backdrop-blur-md rounded-xl p-3 border border-white/10 shadow-2xl min-w-[160px]">
             <div className="flex items-center gap-2 mb-2 border-b border-white/5 pb-1">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase text-white/50">{joinedVoiceChannel}</span>
            </div>
            <div className="space-y-2">
              <div className={cn("flex items-center gap-2", isSpeaking && "scale-105")}>
                <div className={cn("w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold", isSpeaking && "ring-2 ring-green-400")}>{userName.charAt(0)}</div>
                <span className={cn("text-xs font-semibold", isSpeaking ? "text-green-400" : "text-white")}>{userName}</span>
              </div>
              {targetUser && (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold">{targetUser.displayName.charAt(0)}</div>
                  <span className="text-xs font-semibold text-white">{targetUser.displayName}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ekran Paylaşımı Görüntüleme Overlay */}
      {hasRemoteVideo && (
        <div className="absolute inset-0 z-40 bg-black/90 flex flex-col items-center justify-center p-8">
          <div className="w-full h-full max-w-5xl relative group">
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-contain rounded-lg shadow-2xl bg-black"
            />
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur px-3 py-1 rounded-full text-xs font-bold border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
              {targetUser?.displayName} paylaşıyor
            </div>
            <Button 
              variant="destructive" 
              size="icon" 
              className="absolute top-4 right-4 h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setHasRemoteVideo(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <RoomSidebar
        rooms={rooms}
        voiceChannels={voiceChannels}
        activeRoom={activeRoom}
        onRoomSelect={setActiveRoom}
        userName={userName}
        userId={userId}
        userRole={userRole}
        onLogout={onLogout}
        joinedVoiceChannel={joinedVoiceChannel}
        onJoinVoice={handleJoinVoiceChannel}
        onLeaveVoice={handleLeaveVoiceChannel}
        isMuted={isMuted}
        onToggleMute={() => { setIsMuted(!isMuted); localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = isMuted); }}
        isDeafened={isDeafened}
        onToggleDeafen={() => { setIsDeafened(!isDeafened); if (remoteAudioRef.current) remoteAudioRef.current.muted = !isDeafened; }}
        isSpeaking={isSpeaking}
        isScreenSharing={isScreenSharing}
        onToggleScreenShare={handleToggleScreenShare}
        onOpenSettings={() => setIsSettingsOpen(true)}
        userVolumes={userVolumes}
        onVolumeChange={handleVolumeChange}
        onKickUser={handleKickUser}
        onAddChannel={() => setIsAddChannelOpen(true)}
        onDeleteChannel={handleDeleteChannel}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#312B38]">
        <header className="h-14 flex items-center justify-between px-4 border-b border-black/10 bg-card/20">
          <div className="flex items-center gap-2 font-semibold">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <span>{activeRoom}</span>
          </div>
        </header>

        <div className="flex-1 flex flex-col relative overflow-hidden">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 pb-4">
              {messages?.map((msg) => (
                <div key={msg.id} className="group flex flex-col gap-1 hover:bg-black/5 p-2 rounded-md">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-accent text-sm">{msg.displayName}</span>
                    <span className="text-[10px] text-muted-foreground">{msg.createdAt?.toDate?.().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '...'}</span>
                  </div>
                  <p className="text-sm text-foreground/90 break-words">{msg.text}</p>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <form onSubmit={handleSendMessage} className="p-4 shrink-0">
            <div className="relative">
              <Input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={`#${activeRoom} kanalına mesaj gönder`}
                className="w-full bg-black/20 border-none h-11 pr-12"
              />
              <Button type="submit" size="icon" variant="ghost" className="absolute right-1 top-1 h-9 w-9" disabled={!messageText.trim()}>
                <MessageSquare className="w-5 h-5" />
              </Button>
            </div>
          </form>
        </div>
      </main>

      <AudioSettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} settings={audioSettings} onSettingsChange={handleSettingsChange} />
      
      <Dialog open={isAddChannelOpen} onOpenChange={setIsAddChannelOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Yeni Kanal Oluştur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Kanal İsmi</Label>
              <Input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="kanal-ismi" className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label>Kanal Tipi</Label>
              <div className="flex gap-2">
                <Button variant={newChannelType === "text" ? "default" : "outline"} onClick={() => setNewChannelType("text")} className="flex-1">Metin</Button>
                <Button variant={newChannelType === "voice" ? "default" : "outline"} onClick={() => setNewChannelType("voice")} className="flex-1">Ses</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddChannel} disabled={!newChannelName.trim()}>Kanalı Oluştur</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
