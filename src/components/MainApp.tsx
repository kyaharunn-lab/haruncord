
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { RoomSidebar } from "./RoomSidebar";
import { Hash, MessageSquare, Video, MicOff } from "lucide-react";
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
  type AudioSettings,
} from "@/lib/webrtc";
import { AudioSettingsDialog } from "./AudioSettingsDialog";
import { UserRole } from "@/app/page";

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
  const [messageText, setMessageText] = useState("");

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

  // --- WebRTC Mesh Refs ---
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const remoteAudiosRef = useRef<Record<string, HTMLAudioElement>>({});
  const signalingUnsubsRef = useRef<Record<string, Unsubscribe>>({});
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

  // --- Mesajlaşma ---
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

  // --- Presence Dinleme ---
  const presenceQuery = useMemoFirebase(() => db && joinedVoiceChannel ? collection(db, "voiceChannels", joinedVoiceChannel, "presence") : null, [db, joinedVoiceChannel]);
  const { data: presenceData } = useCollection(presenceQuery);
  
  const activeUsers = useMemo(() => {
    if (!presenceData) return [];
    const now = Date.now();
    // Sadece son 15 saniye içinde aktif olanları göster
    return presenceData.filter(u => u.lastSeen && (now - new Date(u.lastSeen).getTime() < 15000));
  }, [presenceData]);

  // --- Ses Ayarları ---
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
      const oldTracks = localStreamRef.current.getTracks();
      const newStream = await getLocalAudioStream(newSettings);
      if (newStream) {
        oldTracks.forEach(t => t.stop());
        localStreamRef.current = newStream;
        newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        Object.values(pcsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
          if (sender && newStream.getAudioTracks()[0]) {
            sender.replaceTrack(newStream.getAudioTracks()[0]);
          }
        });
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
    } catch (err) {}
  }, []);

  const handleLeaveVoiceChannel = useCallback(async () => {
    if (isCleaningUpRef.current) return;
    const channelToLeave = joinedVoiceChannel;
    console.log("🧹 tam cleanup başladı");
    isCleaningUpRef.current = true;
    connectionSessionRef.current += 1;
    
    setJoinedVoiceChannel(null);
    playSoundEffect('leave');

    try {
      // 1. WebRTC Temizliği
      Object.entries(pcsRef.current).forEach(([id, pc]) => {
        closePeerConnection(pc);
        delete pcsRef.current[id];
      });
      Object.entries(remoteAudiosRef.current).forEach(([id, audio]) => {
        audio.pause(); audio.srcObject = null; audio.remove();
        delete remoteAudiosRef.current[id];
      });
      Object.entries(signalingUnsubsRef.current).forEach(([id, unsub]) => {
        unsub();
        delete signalingUnsubsRef.current[id];
      });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }

      // 2. Firestore Temizliği
      if (db && channelToLeave && userId) {
        const batch = writeBatch(db);
        batch.delete(doc(db, "voiceChannels", channelToLeave, "presence", userId));
        
        const q1 = query(collection(db, "voiceChannels", channelToLeave, "calls"), where("offererId", "==", userId));
        const q2 = query(collection(db, "voiceChannels", channelToLeave, "calls"), where("answererId", "==", userId));
        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        
        [...snap1.docs, ...snap2.docs].forEach(d => {
          batch.delete(d.ref);
        });
        await batch.commit();
      }
    } catch (e) { console.warn("Firestore cleanup hatası", e); }
    finally {
      isCleaningUpRef.current = false;
      console.log("✅ tam cleanup bitti");
    }
  }, [db, joinedVoiceChannel, userId, playSoundEffect]);

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    setActiveView({ type: 'voice', id: channel });
    if (joinedVoiceChannel === channel) return;
    
    while (isCleaningUpRef.current) await new Promise(r => setTimeout(r, 50));
    
    // Eğer zaten bir kanaldaysak çıkış yap
    if (joinedVoiceChannel) await handleLeaveVoiceChannel();

    // 1. Kendi eski kayıtlarımızı temizle (Kanal değişmiş olsa bile userId bazlı temizlik)
    if (db) {
      try {
        await deleteDoc(doc(db, "voiceChannels", channel, "presence", userId));
      } catch (e) {}
    }

    // 2. Gerçek aktif kullanıcıları sayarak kapasite kontrolü yap
    const currentPresenceSnap = await getDocs(collection(db!, "voiceChannels", channel, "presence"));
    const now = Date.now();
    const activeUsersCount = currentPresenceSnap.docs.filter(d => {
      const data = d.data();
      // Kendi kaydımız ise sayma (az önce silmiş olsak da listelemede gecikebilir)
      if (data.userId === userId) return false;
      return data.lastSeen && (now - new Date(data.lastSeen).getTime() < 15000);
    }).length;

    if (activeUsersCount >= 5) {
      toast({ 
        variant: "destructive", 
        title: "Kanal Dolu", 
        description: "Bu ses kanalı dolu. Maksimum 5 kişi katılabilir." 
      });
      console.log("❌ kanal dolu (aktif kullanıcılar baz alındı)");
      return;
    }

    try {
      connectionSessionRef.current += 1;
      const currentSession = connectionSessionRef.current;
      console.log(`🚀 yeni bağlantı session başladı: ${currentSession}`);
      
      const stream = await getLocalAudioStream(audioSettings);
      if (currentSession !== connectionSessionRef.current) {
        stream?.getTracks().forEach(t => t.stop());
        return;
      }
      
      if (!stream) throw new Error("Mikrofon alınamadı");
      localStreamRef.current = stream;
      setJoinedVoiceChannel(channel);
      setIsMuted(false);
      setIsDeafened(false);
      playSoundEffect('join');
    } catch (error) {
      console.error("❌ Kanala katılma hatası:", error);
      toast({ variant: "destructive", title: "Hata", description: "Mikrofon erişimi sağlanamadı." });
    }
  }, [joinedVoiceChannel, handleLeaveVoiceChannel, audioSettings, db, userId, playSoundEffect, toast]);

  // --- Mesh Mesh Sinyalleşme Döngüsü ---
  useEffect(() => {
    const sessionId = connectionSessionRef.current;
    if (isCleaningUpRef.current || !joinedVoiceChannel || !localStreamRef.current || sessionId !== connectionSessionRef.current) return;

    const handlePeerSetup = async (remoteUser: any) => {
      const targetId = remoteUser.userId;
      if (targetId === userId || pcsRef.current[targetId]) return;

      const callId = [userId, targetId].sort().join('_');
      const isOfferer = userId === [userId, targetId].sort()[0];
      
      console.log(`📡 peer oluşturuldu: ${targetId} (isOfferer: ${isOfferer}, callId: ${callId})`);
      
      const pc = createPeerConnection();
      if (!pc) return;
      pcsRef.current[targetId] = pc;

      addLocalTracks(pc, localStreamRef.current!);

      pc.onicecandidate = (event) => {
        if (event.candidate && db && joinedVoiceChannel && sessionId === connectionSessionRef.current) {
          const candsRef = collection(db, "voiceChannels", joinedVoiceChannel, "calls", callId, "candidates");
          addDocumentNonBlocking(candsRef, { userId, candidate: event.candidate.toJSON(), createdAt: serverTimestamp() });
          console.log(`📤 ICE gönderildi: ${callId}`);
        }
      };

      pc.ontrack = (event) => {
        if (sessionId !== connectionSessionRef.current) return;
        console.log(`📥 remote stream geldi: ${targetId}`);
        if (!remoteAudiosRef.current[targetId]) {
          const audio = document.createElement("audio");
          audio.autoplay = true;
          audio.playsInline = true;
          document.body.appendChild(audio);
          remoteAudiosRef.current[targetId] = audio;
        }
        remoteAudiosRef.current[targetId].srcObject = event.streams[0];
        remoteAudiosRef.current[targetId].volume = (userVolumes[targetId] ?? 100) / 100;
        remoteAudiosRef.current[targetId].muted = isDeafened;
        console.log(`🔊 remote audio oynatılıyor: ${targetId}`);
      };

      const callDocRef = doc(db!, "voiceChannels", joinedVoiceChannel, "calls", callId);
      const candidatesRef = collection(db!, "voiceChannels", joinedVoiceChannel, "calls", callId, "candidates");
      const processedIce = new Set<string>();

      const unsub = onSnapshot(callDocRef, async (snap) => {
        if (sessionId !== connectionSessionRef.current || !snap.exists()) return;
        const data = snap.data();
        
        if (isOfferer) {
          if (data.answer && pc.signalingState === "have-local-offer") {
            await setRemoteDescription(pc, data.answer);
            console.log(`📥 answer alındı: ${callId}`);
          }
        } else {
          if (data.offer && pc.signalingState === "stable") {
            console.log(`📥 offer alındı: ${callId}`);
            const answer = await createAnswer(pc, data.offer);
            if (answer && sessionId === connectionSessionRef.current) {
              setDocumentNonBlocking(callDocRef, { answer: { type: answer.type, sdp: answer.sdp }, answererId: userId }, { merge: true });
              console.log(`📤 answer yazıldı: ${callId}`);
            }
          }
        }
      });

      const unsubCand = onSnapshot(candidatesRef, (snap) => {
        if (sessionId !== connectionSessionRef.current || !pc.remoteDescription) return;
        snap.docChanges().forEach(change => {
          if (change.type === "added" && change.doc.data().userId !== userId && !processedIce.has(change.doc.id)) {
            addIceCandidate(pc, change.doc.data().candidate);
            processedIce.add(change.doc.id);
            console.log(`📥 ICE alındı: ${callId}`);
          }
        });
      });

      signalingUnsubsRef.current[targetId] = () => { unsub(); unsubCand(); };

      if (isOfferer) {
        const offer = await createOffer(pc);
        if (offer && sessionId === connectionSessionRef.current) {
          setDocumentNonBlocking(callDocRef, { callId, offererId: userId, answererId: targetId, offer: { type: offer.type, sdp: offer.sdp }, createdAt: serverTimestamp() }, { merge: true });
          console.log(`📤 offer yazıldı: ${callId}`);
        }
      }
    };

    activeUsers.forEach(handlePeerSetup);

    Object.keys(pcsRef.current).forEach(pid => {
      if (!activeUsers.find(u => u.userId === pid)) {
        console.log(`🔌 peer kapatıldı: ${pid}`);
        closePeerConnection(pcsRef.current[pid]);
        delete pcsRef.current[pid];
        if (remoteAudiosRef.current[pid]) {
          remoteAudiosRef.current[pid].remove();
          delete remoteAudiosRef.current[pid];
        }
        if (signalingUnsubsRef.current[pid]) {
          signalingUnsubsRef.current[pid]();
          delete signalingUnsubsRef.current[pid];
        }
      }
    });

  }, [activeUsers, joinedVoiceChannel, db, userId, userVolumes, isDeafened]);

  useEffect(() => {
    if (isCleaningUpRef.current || !db || !joinedVoiceChannel || !userId) return;
    const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
    const update = () => {
      if (isCleaningUpRef.current || !joinedVoiceChannel) return;
      setDocumentNonBlocking(presenceRef, {
        userId, displayName: userName, voiceChannelId: joinedVoiceChannel,
        lastSeen: new Date().toISOString(), isMuted, id: userId,
        isSharingScreen: isScreenSharing, isCameraOn: isCameraOn, isSpeaking: isSpeaking,
      }, { merge: true });
    };
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [db, joinedVoiceChannel, userId, userName, isMuted, isScreenSharing, isCameraOn, isSpeaking]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground relative">
      <RoomSidebar
        rooms={rooms} voiceChannels={voiceChannels} activeRoom={activeView.id}
        onRoomSelect={(id) => setActiveView({ type: 'text', id })}
        userName={userName} userId={userId} userRole={userRole} onLogout={onLogout}
        joinedVoiceChannel={joinedVoiceChannel} onJoinVoice={handleJoinVoiceChannel} onLeaveVoice={handleLeaveVoiceChannel}
        isMuted={isMuted} onToggleMute={() => { setIsMuted(!isMuted); localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = isMuted); }}
        isDeafened={isDeafened} onToggleDeafen={() => { setIsDeafened(!isDeafened); Object.values(remoteAudiosRef.current).forEach(a => a.muted = !isDeafened); }}
        isSpeaking={isSpeaking} isScreenSharing={isScreenSharing} onToggleScreenShare={() => {}}
        isCameraOn={isCameraOn} onToggleCamera={() => {}}
        onOpenSettings={() => setIsSettingsOpen(true)}
        userVolumes={userVolumes} onVolumeChange={handleVolumeChange} onKickUser={() => {}}
        onAddChannel={() => {}} onDeleteChannel={() => {}}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#312B38]">
        <header className="h-14 flex items-center justify-between px-4 border-b border-black/10 bg-card/20 font-semibold uppercase tracking-wider text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4" />
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
          <div className="flex-1 bg-[#1E1F22] p-6 overflow-hidden flex flex-col items-center justify-center">
             <div className={cn(
                "grid gap-4 w-full max-w-6xl",
                activeUsers.length <= 1 ? "grid-cols-1" : 
                activeUsers.length === 2 ? "grid-cols-2" :
                "grid-cols-2 lg:grid-cols-3"
              )}>
                {activeUsers.map((u) => (
                  <div key={u.id} className={cn(
                    "aspect-video bg-[#2B2D31] rounded-xl flex flex-col items-center justify-center relative overflow-hidden border-2 transition-all duration-300",
                    u.isSpeaking ? "border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]" : "border-transparent"
                  )}>
                    <div className="w-24 h-24 rounded-full bg-primary flex items-center justify-center text-3xl font-bold shadow-xl">
                      {u.displayName.charAt(0)}
                    </div>
                    <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-md backdrop-blur-sm">
                      <span className="text-sm font-bold text-white">{u.displayName}</span>
                      {u.isMuted && <MicOff className="w-3.5 h-3.5 text-destructive" />}
                    </div>
                  </div>
                ))}
                {activeUsers.length === 0 && <p className="text-muted-foreground">Bu ses kanalında kimse yok.</p>}
              </div>
          </div>
        )}
      </main>

      <AudioSettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} settings={audioSettings} onSettingsChange={handleSettingsChange} />
    </div>
  );
}
