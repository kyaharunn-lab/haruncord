"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { RoomSidebar } from "./RoomSidebar";
import { Hash, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useMemoFirebase, useCollection, useDoc } from "@/firebase";
import { doc, collection, serverTimestamp, getDocs, query, where, writeBatch } from "firebase/firestore";
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

interface MainAppProps {
  userName: string;
  userId: string;
  onLogout: () => void;
}

export function MainApp({ userName, userId, onLogout }: MainAppProps) {
  const rooms = ["Genel", "Oyun", "Muhabbet"];
  const voiceChannels = ["Test Ses", "Oyun Ses", "Muhabbet Ses"];

  const [activeRoom, setActiveRoom] = useState(rooms[0]);
  const [joinedVoiceChannel, setJoinedVoiceChannel] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Audio Settings State
  const [audioSettings, setAudioSettings] = useState<AudioSettings & { outputDeviceId?: string }>({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    deviceId: "default",
    outputDeviceId: "default",
  });

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const processedIceCandidatesRef = useRef<Set<string>>(new Set());

  const { toast } = useToast();
  const db = useFirestore();

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("kanka_audio_settings");
    if (saved) {
      try {
        setAudioSettings(JSON.parse(saved));
      } catch (e) {
        console.error("Ayarlar yüklenemedi:", e);
      }
    }
  }, []);

  // Apply output device whenever it or the remote audio element changes
  useEffect(() => {
    if (remoteAudioRef.current && audioSettings.outputDeviceId) {
      setAudioOutputDevice(remoteAudioRef.current, audioSettings.outputDeviceId);
    }
  }, [audioSettings.outputDeviceId]);

  // Handle settings change
  const handleSettingsChange = useCallback(async (newSettings: AudioSettings & { outputDeviceId?: string }) => {
    setAudioSettings(newSettings);
    
    // If we are currently in a channel, update the stream
    if (joinedVoiceChannel && localStreamRef.current) {
      const oldTracks = localStreamRef.current.getTracks();
      const newStream = await getLocalAudioStream(newSettings);
      
      if (newStream) {
        // Stop old tracks
        oldTracks.forEach(t => t.stop());
        
        // Update ref
        localStreamRef.current = newStream;
        
        // Respect current mute state
        newStream.getAudioTracks().forEach(t => t.enabled = !isMuted);

        // Replace track in peer connection if it exists
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const audioSender = senders.find(s => s.track?.kind === 'audio');
          const newTrack = newStream.getAudioTracks()[0];
          
          if (audioSender && newTrack) {
            audioSender.replaceTrack(newTrack);
            console.log("Mikrofon stream'i başarıyla güncellendi.");
          }
        }
      }
    }
  }, [joinedVoiceChannel, isMuted]);

  // Lokal Ses Efektleri
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
    } catch (err) {
      console.warn("Ses efekti çalınamadı:", err);
    }
  }, []);

  // Voice Activity Detection
  useEffect(() => {
    if (!localStreamRef.current || isMuted || !joinedVoiceChannel) {
      setIsSpeaking(false);
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let animationId = 0;
    let lastSpeakState = false;

    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(localStreamRef.current);
      source.connect(analyser);
      analyser.fftSize = 256;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((total, value) => total + value, 0);
        const average = sum / bufferLength;
        const speaking = average > 15;

        if (speaking !== lastSpeakState) {
          setIsSpeaking(speaking);
          lastSpeakState = speaking;
          if (speaking) console.log("mikrofon ses algılıyor");
          else console.log("mikrofon sessiz");
        }
        animationId = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (err) {
      console.error("Ses analizi başlatılamadı:", err);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (audioContext) audioContext.close();
    };
  }, [joinedVoiceChannel, isMuted, audioSettings]); // Re-init analysis when stream potentially changes

  // Presence Sync
  useEffect(() => {
    if (!db || !joinedVoiceChannel || !userId) return;
    const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
    setDocumentNonBlocking(presenceRef, {
      userId,
      displayName: userName,
      channelId: joinedVoiceChannel,
      joinedAt: serverTimestamp(),
      isMuted,
    }, { merge: true });

    return () => {
      deleteDocumentNonBlocking(presenceRef);
    };
  }, [db, joinedVoiceChannel, userId, userName, isMuted]);

  // Channel Users
  const activePresenceQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel) return null;
    return collection(db, "voiceChannels", joinedVoiceChannel, "presence");
  }, [db, joinedVoiceChannel]);
  const { data: channelUsers } = useCollection(activePresenceQuery);

  // Call Management Logic
  const targetUser = useMemo(() => {
    if (!channelUsers) return null;
    return channelUsers.find(u => u.userId !== userId) || null;
  }, [channelUsers, userId]);

  const callInfo = useMemo(() => {
    if (!targetUser || !userId) return null;
    const ids = [userId, targetUser.userId].sort();
    return {
      callId: ids.join('_'),
      offererId: ids[0],
      answererId: ids[1],
      isOfferer: userId === ids[0]
    };
  }, [targetUser, userId]);

  const callDocRef = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel || !callInfo) return null;
    return doc(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId);
  }, [db, joinedVoiceChannel, callInfo]);

  const { data: callData } = useDoc(callDocRef);

  const candidatesQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel || !callInfo) return null;
    return collection(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId, "candidates");
  }, [db, joinedVoiceChannel, callInfo]);

  const { data: remoteCandidates } = useCollection(candidatesQuery);

  // PeerConnection Setup
  const setupPeerConnection = useCallback(() => {
    const pc = createPeerConnection();
    if (!pc) return null;

    pc.onicecandidate = (event) => {
      if (event.candidate && db && joinedVoiceChannel && callInfo) {
        const candsRef = collection(db, "voiceChannels", joinedVoiceChannel, "calls", callInfo.callId, "candidates");
        addDocumentNonBlocking(candsRef, {
          userId,
          candidate: event.candidate.toJSON(),
          createdAt: serverTimestamp(),
        });
        console.log("ICE yazıldı");
      }
    };

    pc.ontrack = (event) => {
      console.log("remote stream geldi");
      const remoteStream = event.streams[0];
      if (!remoteStream) return;

      if (!remoteAudioRef.current) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);
        remoteAudioRef.current = audio;
        
        // Apply output device to the new element
        if (audioSettings.outputDeviceId) {
          setAudioOutputDevice(audio, audioSettings.outputDeviceId);
        }
      }
      
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.muted = isDeafened;
      remoteAudioRef.current.play()
        .then(() => console.log("remote audio oynatılıyor"))
        .catch(e => console.error("remote audio oynatma hatası:", e));
    };

    if (localStreamRef.current) {
      addLocalTracks(pc, localStreamRef.current);
    }

    return pc;
  }, [db, joinedVoiceChannel, callInfo, userId, isDeafened, audioSettings.outputDeviceId]);

  // Signaling Flow
  useEffect(() => {
    const handleSignaling = async () => {
      if (!callInfo || !callDocRef || !db) return;

      if (callInfo.isOfferer) {
        if (!peerConnectionRef.current) {
          const pc = setupPeerConnection();
          if (!pc) return;
          peerConnectionRef.current = pc;
          
          const offer = await createOffer(pc);
          if (offer) {
            setDocumentNonBlocking(callDocRef, {
              callId: callInfo.callId,
              offererId: callInfo.offererId,
              answererId: callInfo.answererId,
              offer: { type: offer.type, sdp: offer.sdp },
              createdAt: serverTimestamp(),
            }, { merge: true });
            console.log("offer firestore yazıldı");
          }
        }

        if (callData?.answer && peerConnectionRef.current?.signalingState === "have-local-offer") {
          console.log("answer alındı");
          await setRemoteDescription(peerConnectionRef.current, callData.answer);
          console.log("answer uygulandı");
        }
      } 
      else {
        if (callData?.offer && !peerConnectionRef.current) {
          console.log("offer alındı");
          const pc = setupPeerConnection();
          if (!pc) return;
          peerConnectionRef.current = pc;

          const answer = await createAnswer(pc, callData.offer);
          if (answer) {
            setDocumentNonBlocking(callDocRef, {
              answer: { type: answer.type, sdp: answer.sdp },
              answererId: userId,
            }, { merge: true });
            console.log("answer firestore yazıldı");
          }
        }
      }
    };

    handleSignaling();
  }, [callInfo, callData, callDocRef, db, setupPeerConnection, userId]);

  // ICE Candidate Processing
  useEffect(() => {
    if (!remoteCandidates || !peerConnectionRef.current) return;
    const pc = peerConnectionRef.current;

    remoteCandidates.forEach(doc => {
      if (doc.userId !== userId && !processedIceCandidatesRef.current.has(doc.id)) {
        addIceCandidate(pc, doc.candidate);
        processedIceCandidatesRef.current.add(doc.id);
        console.log("ICE alındı");
      }
    });
  }, [remoteCandidates, userId]);

  // Cleanup Logic
  const handleLeaveVoiceChannel = useCallback(async () => {
    if (joinedVoiceChannel) playSoundEffect('leave');

    if (peerConnectionRef.current) {
      closePeerConnection(peerConnectionRef.current);
      peerConnectionRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
    }

    if (db && joinedVoiceChannel && userId) {
      const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);
      deleteDocumentNonBlocking(presenceRef);
      console.log("presence temizlendi");

      try {
        const callsRef = collection(db, "voiceChannels", joinedVoiceChannel, "calls");
        const qOfferer = query(callsRef, where("offererId", "==", userId));
        const qAnswerer = query(callsRef, where("answererId", "==", userId));

        const [offererSnap, answererSnap] = await Promise.all([
          getDocs(qOfferer),
          getDocs(qAnswerer)
        ]);

        const batch = writeBatch(db);
        [...offererSnap.docs, ...answererSnap.docs].forEach(d => {
          batch.delete(d.ref);
        });
        await batch.commit();
        console.log("call temizlendi");
      } catch (e) {
        console.warn("Call temizlenirken hata oluştu (önemsiz):", e);
      }
    }

    processedIceCandidatesRef.current.clear();
    setJoinedVoiceChannel(null);
    setIsSpeaking(false);
    setIsDeafened(false);
  }, [db, joinedVoiceChannel, userId, playSoundEffect]);

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    if (joinedVoiceChannel === channel) return;
    if (joinedVoiceChannel) await handleLeaveVoiceChannel();

    // Pre-cleanup
    if (db && userId) {
      try {
        const callsRef = collection(db, "voiceChannels", channel, "calls");
        const qUser = query(callsRef, where("offererId", "==", userId));
        const qUser2 = query(callsRef, where("answererId", "==", userId));
        const [snap1, snap2] = await Promise.all([getDocs(qUser), getDocs(qUser2)]);
        const batch = writeBatch(db);
        [...snap1.docs, ...snap2.docs].forEach(d => batch.delete(d.ref));
        await batch.commit();
      } catch (e) {
        console.warn("Ön temizlik başarısız (önemsiz):", e);
      }
    }

    try {
      const stream = await getLocalAudioStream(audioSettings);
      if (!stream) throw new Error("Mikrofon izni gerekli.");
      localStreamRef.current = stream;
      setJoinedVoiceChannel(channel);
      setIsMuted(false);
      setIsDeafened(false);
      playSoundEffect('join');
      toast({ title: "Sesli Kanala Katılındı", description: `${channel} kanalına bağlandınız.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Mikrofon erişimi sağlanamadı." });
    }
  }, [toast, joinedVoiceChannel, handleLeaveVoiceChannel, db, userId, playSoundEffect, audioSettings]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const newState = !isMuted;
    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !newState);
    setIsMuted(newState);
    if (newState) setIsSpeaking(false);
  }, [isMuted]);

  const toggleDeafen = useCallback(() => {
    const newState = !isDeafened;
    setIsDeafened(newState);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = newState;
    }
  }, [isDeafened]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-body">
      <RoomSidebar
        rooms={rooms}
        voiceChannels={voiceChannels}
        activeRoom={activeRoom}
        onRoomSelect={setActiveRoom}
        userName={userName}
        userId={userId}
        onLogout={onLogout}
        joinedVoiceChannel={joinedVoiceChannel}
        onJoinVoice={handleJoinVoiceChannel}
        onLeaveVoice={handleLeaveVoiceChannel}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        isDeafened={isDeafened}
        onToggleDeafen={toggleDeafen}
        isSpeaking={isSpeaking}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#312B38]">
        <header className="h-14 flex items-center justify-between px-4 border-b border-black/10 shadow-sm bg-card/20">
          <div className="flex items-center gap-2 font-semibold">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <span className="text-foreground">{activeRoom}</span>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col p-6 space-y-4">
            <div className="flex flex-col items-center justify-center flex-1 text-center opacity-40">
              <div className="p-6 bg-black/10 rounded-full mb-4">
                <MessageSquare className="w-16 h-16" />
              </div>
              <h2 className="text-2xl font-bold">Hoş geldin, {userName}!</h2>
              <p className="max-w-xs mt-2 italic text-sm">Burası {activeRoom} odası. Henüz mesaj yok.</p>
            </div>
          </div>

          <aside className="w-60 bg-black/10 border-l border-black/5 hidden lg:block">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-6">
                <div>
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-3">
                    {joinedVoiceChannel ? `${joinedVoiceChannel} — ${channelUsers?.length || 0}` : "Çevrimiçi — 1"}
                  </h3>
                  <div className="space-y-1">
                    {joinedVoiceChannel && channelUsers ? channelUsers.map((u) => (
                      <div key={u.id} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group">
                        <div className="relative">
                          <div className={cn(
                            "w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-xs transition-all duration-200",
                            u.userId === userId && isSpeaking && "ring-2 ring-green-500 ring-offset-2 ring-offset-[#312B38]"
                          )}>
                            {u.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-accent truncate">{u.displayName}</span>
                          <span className="text-[10px] text-muted-foreground truncate leading-none">{u.isMuted ? "Susturuldu" : "Sesli"}</span>
                        </div>
                      </div>
                    )) : (
                      <div className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group">
                        <div className="relative">
                          <div className={cn(
                            "w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-xs transition-all duration-200",
                            isSpeaking && "ring-2 ring-green-500 ring-offset-2 ring-offset-[#312B38]"
                          )}>
                            {userName.charAt(0).toUpperCase()}
                          </div>
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-accent truncate">{userName}</span>
                          <span className="text-[11px] text-muted-foreground leading-none">Çevrimiçi</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </aside>
        </div>
      </main>

      <AudioSettingsDialog
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={audioSettings}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  );
}
