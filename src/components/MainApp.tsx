
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { RoomSidebar } from "./RoomSidebar";
import { Hash, MessageSquare, Plus, Trash2, Monitor, X, MicOff, Video, User, Camera, CameraOff } from "lucide-react";
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
  const [activeView, setActiveView] = useState<{ type: 'text' | 'voice', id: string }>({ type: 'text', id: 'Genel' });
  const [joinedVoiceChannel, setJoinedVoiceChannel] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
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
    micSensitivity: 0.03,
    gateLevel: 0.5,
    gateSmoothing: 0.5,
    micGain: 1.0,
    deviceId: "default",
    outputDeviceId: "default",
    qualityMode: "balanced"
  });

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const voiceRoomVideosRef = useRef<Record<string, HTMLVideoElement | null>>({});
  const processedIceCandidatesRef = useRef<Set<string>>(new Set());
  const isCleaningUpRef = useRef(false);
  const connectionSessionRef = useRef(0);
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

  // Varsayılan kanalları oluştur
  useEffect(() => {
    if (db && roomsData && roomsData.length === 0) {
      ["Genel", "Oyun", "Muhabbet"].forEach(id => {
        setDoc(doc(db, "textChannels", id), { createdAt: serverTimestamp() });
      });
    }
    if (db && voiceChannelsData && voiceChannelsData.length === 0) {
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
      if (type === "text" && activeView.id === id) setActiveView({ type: 'text', id: 'Genel' });
      toast({ title: "Kanal Silindi", description: `${id} başarıyla kaldırıldı.` });
    } catch (e) {
      console.error(e);
    }
  };

  // --- Mesajlaşma Mantığı ---
  const messagesQuery = useMemoFirebase(() => {
    if (!db || activeView.type !== 'text') return null;
    return query(
      collection(db, "textChannels", activeView.id, "messages"),
      orderBy("createdAt", "asc"),
      limit(50)
    );
  }, [db, activeView]);

  const { data: messages } = useCollection(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !db || activeView.type !== 'text') return;

    const messagesRef = collection(db, "textChannels", activeView.id, "messages");
    addDocumentNonBlocking(messagesRef, {
      text: messageText.trim(),
      userId,
      displayName: userName,
      createdAt: serverTimestamp(),
    });

    setMessageText("");
  };

  // --- Sesli Sohbet Mantığı ---
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
          if (audioSender && newTrack) {
            audioSender.replaceTrack(newTrack).then(() => console.log("🔄 Audio track başarıyla değiştirildi"));
          }
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

  const handleLeaveVoiceChannel = useCallback(async () => {
    if (isCleaningUpRef.current) return;
    
    const currentChannel = joinedVoiceChannel;
    console.log("🧹 tam cleanup başladı");
    isCleaningUpRef.current = true;
    connectionSessionRef.current += 1; // Session'ı geçersiz kıl
    
    setJoinedVoiceChannel(null);
    playSoundEffect('leave');
    
    try {
      // 1. WebRTC Temizliği
      if (peerConnectionRef.current) {
        closePeerConnection(peerConnectionRef.current);
        peerConnectionRef.current = null;
      }
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
      
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }

      // 2. Firestore Temizliği (Presence ve Calls)
      if (db && currentChannel && userId) {
        const batch = writeBatch(db);
        
        // Kendi presence kaydını sil
        batch.delete(doc(db, "voiceChannels", currentChannel, "presence", userId));
        
        // Kendi dahil olduğu çağrıları sil
        const q1 = query(collection(db, "voiceChannels", currentChannel, "calls"), where("offererId", "==", userId));
        const q2 = query(collection(db, "voiceChannels", currentChannel, "calls"), where("answererId", "==", userId));
        const snaps = await Promise.all([getDocs(q1), getDocs(q2)]);
        
        for (const snap of snaps) {
          for (const d of snap.docs) {
            batch.delete(d.ref);
            // Candidates alt koleksiyonunu silmek için docs okumalıyız
            const candsRef = collection(db, "voiceChannels", currentChannel, "calls", d.id, "candidates");
            const cSnap = await getDocs(candsRef);
            cSnap.docs.forEach(cd => batch.delete(cd.ref));
          }
        }
        await batch.commit();
      }
    } catch (e) {
      console.warn("Firestore cleanup hatası", e);
    } finally {
      processedIceCandidatesRef.current.clear();
      setIsSpeaking(false);
      setIsScreenSharing(false);
      setIsCameraOn(false);
      setHasRemoteVideo(false);
      isCleaningUpRef.current = false;
      console.log("✅ tam cleanup bitti");
    }
  }, [db, joinedVoiceChannel, userId, playSoundEffect]);

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    setActiveView({ type: 'voice', id: channel });
    if (joinedVoiceChannel === channel) return;
    
    // Eğer temizlik devam ediyorsa bekle
    while (isCleaningUpRef.current) {
      await new Promise(r => setTimeout(r, 50));
    }
    
    // Zaten başka bir kanaldaysak önce oradan temizce çık
    if (joinedVoiceChannel) {
      await handleLeaveVoiceChannel();
    }
    
    try {
      // Katılmadan önce hedef kanaldaki eski artıklarımı temizle (Sert Fix)
      if (db && userId) {
        console.log(`🧼 ${channel} kanalı için ön temizlik yapılıyor...`);
        const batch = writeBatch(db);
        const q1 = query(collection(db, "voiceChannels", channel, "calls"), where("offererId", "==", userId));
        const q2 = query(collection(db, "voiceChannels", channel, "calls"), where("answererId", "==", userId));
        const snaps = await Promise.all([getDocs(q1), getDocs(q2)]);
        for (const snap of snaps) {
          for (const d of snap.docs) {
            batch.delete(d.ref);
            const cands = await getDocs(collection(db, "voiceChannels", channel, "calls", d.id, "candidates"));
            cands.docs.forEach(cd => batch.delete(cd.ref));
          }
        }
        batch.delete(doc(db, "voiceChannels", channel, "presence", userId));
        await batch.commit();
      }

      connectionSessionRef.current += 1;
      const currentSession = connectionSessionRef.current;
      console.log(`🚀 yeni bağlantı session başladı: ${currentSession}`);
      
      const stream = await getLocalAudioStream(audioSettings);
      
      // Eğer stream alınana kadar kanal değişmişse veya session eskimişse iptal et
      if (currentSession !== connectionSessionRef.current) {
        console.log("🛑 eski session iptal edildi");
        stream?.getTracks().forEach(t => t.stop());
        return;
      }
      
      if (!stream) throw new Error("Mikrofon alınamadı");
      
      localStreamRef.current = stream;
      setJoinedVoiceChannel(channel);
      setIsMuted(false);
      setIsDeafened(false);
      playSoundEffect('join');
      console.log("🎙️ mikrofon alındı ve kanal ayarlandı");
    } catch (error) { 
      console.error("❌ Kanala katılma hatası:", error);
      toast({ variant: "destructive", title: "Hata", description: "Mikrofon erişimi sağlanamadı." }); 
    }
  }, [joinedVoiceChannel, handleLeaveVoiceChannel, audioSettings, db, userId, playSoundEffect, toast]);

  // --- WebRTC Otomatik Bağlantı Döngüsü (Guarded) ---
  const channelUsersQuery = useMemoFirebase(() => db && joinedVoiceChannel ? collection(db, "voiceChannels", joinedVoiceChannel, "presence") : null, [db, joinedVoiceChannel]);
  const { data: rawChannelUsers } = useCollection(channelUsersQuery);
  const channelUsers = useMemo(() => {
    if (!rawChannelUsers) return null;
    const now = Date.now();
    return rawChannelUsers.filter(u => u.lastSeen && (now - new Date(u.lastSeen).getTime() < 15000));
  }, [rawChannelUsers]);

  // Sadece karşıdaki bir kullanıcıyla eşleş (Basit P2P mantığı)
  const targetUser = useMemo(() => channelUsers?.find(u => u.userId !== userId) || null, [channelUsers, userId]);

  const callInfo = useMemo(() => {
    if (isCleaningUpRef.current || !joinedVoiceChannel || !targetUser || !userId) return null;
    const ids = [userId, targetUser.userId].sort();
    return { callId: ids.join('_'), offererId: ids[0], answererId: ids[1], isOfferer: userId === ids[0] };
  }, [targetUser, userId, joinedVoiceChannel]);

  const callDocRef = useMemoFirebase(() => db && joinedVoiceChannel && callInfo ? doc(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId) : null, [db, joinedVoiceChannel, callInfo]);
  const { data: callData } = useDoc(callDocRef);

  const candidatesQuery = useMemoFirebase(() => db && joinedVoiceChannel && callInfo ? collection(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId, "candidates") : null, [db, joinedVoiceChannel, callInfo]);
  const { data: remoteCandidates } = useCollection(candidatesQuery);

  const setupPeerConnection = useCallback((sessionId: number) => {
    if (isCleaningUpRef.current || !joinedVoiceChannel || sessionId !== connectionSessionRef.current) {
      return null;
    }
    const pc = createPeerConnection();
    if (!pc) return null;

    pc.onicecandidate = (event) => {
      if (event.candidate && db && joinedVoiceChannel && callInfo && sessionId === connectionSessionRef.current) {
        const candsRef = collection(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId, "candidates");
        addDocumentNonBlocking(candsRef, { userId, candidate: event.candidate.toJSON(), createdAt: serverTimestamp() });
        console.log("📤 ICE gönderildi");
      }
    };

    pc.ontrack = (event) => {
      if (sessionId !== connectionSessionRef.current) return;
      console.log("📥 remote stream geldi:", event.track.kind);
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
        remoteAudioRef.current.play().catch(e => console.error("❌ Audio play hatası:", e));
        console.log("🔊 remote audio oynatılıyor");
      }
    };

    if (localStreamRef.current) {
      addLocalTracks(pc, localStreamRef.current);
      console.log("✅ audio track eklendi");
    }
    return pc;
  }, [db, joinedVoiceChannel, callInfo, userId, isDeafened, userVolumes]);

  // Signaling Effect
  useEffect(() => {
    const sessionId = connectionSessionRef.current;
    if (isCleaningUpRef.current || !joinedVoiceChannel || !callInfo || !callDocRef || !localStreamRef.current || sessionId !== connectionSessionRef.current) {
      return;
    }

    const handleSignaling = async () => {
      if (callInfo.isOfferer) {
        if (!peerConnectionRef.current) {
          const pc = setupPeerConnection(sessionId);
          if (!pc) return;
          peerConnectionRef.current = pc;
          const offer = await createOffer(pc);
          if (offer && sessionId === connectionSessionRef.current) {
            setDocumentNonBlocking(callDocRef, { ...callInfo, offer: { type: offer.type, sdp: offer.sdp }, createdAt: serverTimestamp() }, { merge: true });
            console.log("📤 offer yazıldı");
          }
        }
        if (callData?.answer && peerConnectionRef.current?.signalingState === "have-local-offer" && sessionId === connectionSessionRef.current) {
          await setRemoteDescription(peerConnectionRef.current, callData.answer);
          console.log("📥 answer alındı");
        }
      } else if (callData?.offer && !peerConnectionRef.current) {
        const pc = setupPeerConnection(sessionId);
        if (!pc) return;
        peerConnectionRef.current = pc;
        const answer = await createAnswer(pc, callData.offer);
        if (answer && sessionId === connectionSessionRef.current) {
          setDocumentNonBlocking(callDocRef, { answer: { type: answer.type, sdp: answer.sdp }, answererId: userId }, { merge: true });
          console.log("📤 answer yazıldı");
        }
      }
    };
    handleSignaling();
  }, [callInfo, callData, callDocRef, setupPeerConnection, joinedVoiceChannel, localStreamRef.current]);

  // ICE Effect
  useEffect(() => {
    const sessionId = connectionSessionRef.current;
    if (isCleaningUpRef.current || !joinedVoiceChannel || !remoteCandidates || !peerConnectionRef.current || sessionId !== connectionSessionRef.current) return;
    if (peerConnectionRef.current.remoteDescription) {
      remoteCandidates.forEach(doc => {
        if (doc.userId !== userId && !processedIceCandidatesRef.current.has(doc.id) && sessionId === connectionSessionRef.current) {
          addIceCandidate(peerConnectionRef.current!, doc.candidate);
          processedIceCandidatesRef.current.add(doc.id);
          console.log("📥 ICE alındı");
        }
      });
    }
  }, [remoteCandidates, joinedVoiceChannel]);

  // --- Varlık (Presence) Effect ---
  useEffect(() => {
    if (isCleaningUpRef.current || !db || !joinedVoiceChannel || !userId) return;
    const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
    const updatePresence = () => {
      if (isCleaningUpRef.current || !joinedVoiceChannel) return;
      setDocumentNonBlocking(presenceRef, {
        userId, 
        displayName: userName, 
        voiceChannelId: joinedVoiceChannel,
        lastSeen: new Date().toISOString(), 
        isMuted, 
        id: userId,
        isSharingScreen: isScreenSharing,
        isCameraOn: isCameraOn,
        isSpeaking: isSpeaking,
      }, { merge: true });
    };
    updatePresence();
    const heartbeat = setInterval(updatePresence, 5000);
    return () => clearInterval(heartbeat);
  }, [db, joinedVoiceChannel, userId, userName, isMuted, isScreenSharing, isCameraOn, isSpeaking]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground relative">
      <RoomSidebar
        rooms={rooms}
        voiceChannels={voiceChannels}
        activeRoom={activeView.id}
        onRoomSelect={(id) => setActiveView({ type: 'text', id })}
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
        onToggleScreenShare={() => {}} // Ses stabilitesi için geçici devre dışı
        isCameraOn={isCameraOn}
        onToggleCamera={() => {}} // Ses stabilitesi için geçici devre dışı
        onOpenSettings={() => setIsSettingsOpen(true)}
        userVolumes={userVolumes}
        onVolumeChange={handleVolumeChange}
        onKickUser={() => {}}
        onAddChannel={() => setIsAddChannelOpen(true)}
        onDeleteChannel={handleDeleteChannel}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#312B38]">
        <header className="h-14 flex items-center justify-between px-4 border-b border-black/10 bg-card/20">
          <div className="flex items-center gap-2 font-semibold">
            {activeView.type === 'text' ? <Hash className="w-5 h-5 text-muted-foreground" /> : <Video className="w-5 h-5 text-muted-foreground" />}
            <span>{activeView.id}</span>
          </div>
        </header>

        {activeView.type === 'text' ? (
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
                <Input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder={`#${activeView.id} kanalına mesaj gönder`} className="w-full bg-black/20 border-none h-11 pr-12" />
                <Button type="submit" size="icon" variant="ghost" className="absolute right-1 top-1 h-9 w-9" disabled={!messageText.trim()}>
                  <MessageSquare className="w-5 h-5" />
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex-1 bg-[#1E1F22] p-6 overflow-hidden flex flex-col">
            <div className={cn(
              "flex-1 grid gap-4 items-center justify-center content-center w-full",
              activeView.id && "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            )}>
              {/* Voice Room View Users Grid (Gerektiğinde presence verisinden map edilir) */}
              <div className="col-span-full text-center opacity-40">
                <p className="text-xl font-medium">#{activeView.id} ses odasındasınız.</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <AudioSettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} settings={audioSettings} onSettingsChange={handleSettingsChange} />
      
      <Dialog open={isAddChannelOpen} onOpenChange={setIsAddChannelOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle>Yeni Kanal Oluştur</DialogTitle></DialogHeader>
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
          <DialogFooter><Button onClick={handleAddChannel} disabled={!newChannelName.trim()}>Kanalı Oluştur</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
