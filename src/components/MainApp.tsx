"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { RoomSidebar } from "./RoomSidebar";
import { Hash, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useMemoFirebase, useCollection, useDoc } from "@/firebase";
import { doc, collection, serverTimestamp } from "firebase/firestore";
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
} from "@/lib/webrtc";

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
  const [isSpeaking, setIsSpeaking] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const processedCallIdRef = useRef<string | null>(null);
  const processedIceCandidatesRef = useRef<Set<string>>(new Set());

  const { toast } = useToast();
  const db = useFirestore();

  // Voice Activity Detection (Glow Efekti)
  useEffect(() => {
    if (!localStreamRef.current || isMuted || !joinedVoiceChannel) {
      setIsSpeaking(false);
      return;
    }

    let audioContext: AudioContext | null = null;
    let animationId = 0;
    let lastSpeakState = false;

    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(localStreamRef.current);
      source.connect(analyser);
      analyser.fftSize = 256;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((total, value) => total + value, 0);
        const average = sum / bufferLength;
        const speaking = average > 15;

        if (speaking !== lastSpeakState) {
          setIsSpeaking(speaking);
          lastSpeakState = speaking;
          console.log(speaking ? "mikrofon ses algılıyor" : "mikrofon sessiz");
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
  }, [joinedVoiceChannel, isMuted]);

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
    return () => { deleteDocumentNonBlocking(presenceRef); };
  }, [db, joinedVoiceChannel, userId, userName, isMuted]);

  // Channel Users
  const activePresenceQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel) return null;
    return collection(db, "voiceChannels", joinedVoiceChannel, "presence");
  }, [db, joinedVoiceChannel]);
  const { data: channelUsers } = useCollection(activePresenceQuery);

  // Deterministik Call Yönetimi
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
      }
      
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play()
        .then(() => console.log("remote audio oynatılıyor"))
        .catch(e => console.error("remote audio oynatma hatası:", e));
    };

    pc.onconnectionstatechange = () => {
      console.log("peer state:", pc.connectionState);
      if (pc.connectionState === 'connected') console.log("peer connected");
    };

    if (localStreamRef.current) {
      addLocalTracks(pc, localStreamRef.current);
    }

    return pc;
  }, [db, joinedVoiceChannel, callInfo, userId]);

  // Signaling Flow
  useEffect(() => {
    const handleSignaling = async () => {
      if (!callInfo || !callDocRef || !db) return;

      // Offerer Logic
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
            console.log("offer yazıldı");
          }
        }

        if (callData?.answer && peerConnectionRef.current?.signalingState === "have-local-offer") {
          console.log("answer alındı");
          await setRemoteDescription(peerConnectionRef.current, callData.answer);
          console.log("answer uygulandı");
        }
      } 
      // Answerer Logic
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
            }, { merge: true });
            console.log("answer yazıldı");
          }
        }
      }
    };

    handleSignaling();
  }, [callInfo, callData, callDocRef, db, setupPeerConnection]);

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

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    if (joinedVoiceChannel === channel) return;
    handleLeaveVoiceChannel();

    try {
      const stream = await getLocalAudioStream();
      if (!stream) throw new Error("Mikrofon izni gerekli.");
      localStreamRef.current = stream;
      setJoinedVoiceChannel(channel);
      setIsMuted(false);
      toast({ title: "Sesli Kanala Katılındı", description: `${channel} kanalına bağlandınız.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Hata", description: "Mikrofon erişimi sağlanamadı." });
    }
  }, [toast, joinedVoiceChannel]);

  const handleLeaveVoiceChannel = useCallback(() => {
    if (peerConnectionRef.current) closePeerConnection(peerConnectionRef.current);
    peerConnectionRef.current = null;
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
    }

    if (callDocRef && userId) {
      deleteDocumentNonBlocking(callDocRef);
    }

    processedIceCandidatesRef.current.clear();
    setJoinedVoiceChannel(null);
    setIsSpeaking(false);
  }, [callDocRef, userId]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const newState = !isMuted;
    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !newState);
    setIsMuted(newState);
    if (newState) setIsSpeaking(false);
  }, [isMuted]);

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
        isSpeaking={isSpeaking}
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
    </div>
  );
}