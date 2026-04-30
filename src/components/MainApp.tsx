"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { RoomSidebar } from "./RoomSidebar";
import { Hash, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useFirestore, useMemoFirebase, useCollection } from "@/firebase";
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
import { saveIceCandidate } from "@/lib/signaling";

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

  const processedOffersRef = useRef<Set<string>>(new Set());
  const processedAnswersRef = useRef<Set<string>>(new Set());
  const processedCandidatesRef = useRef<Set<string>>(new Set());
  const offerSentRef = useRef(false);

  const { toast } = useToast();
  const db = useFirestore();

  // Voice Activity Detection
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

  const activePresenceQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel) return null;
    return collection(db, "voiceChannels", joinedVoiceChannel, "presence");
  }, [db, joinedVoiceChannel]);

  const { data: channelUsers } = useCollection(activePresenceQuery);

  const offersQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel) return null;
    return collection(db, "voiceChannels", joinedVoiceChannel, "offers");
  }, [db, joinedVoiceChannel]);

  const { data: offers } = useCollection(offersQuery);

  const answersQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel) return null;
    return collection(db, "voiceChannels", joinedVoiceChannel, "answers");
  }, [db, joinedVoiceChannel]);

  const { data: answers } = useCollection(answersQuery);

  const candidatesQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel) return null;
    return collection(db, "voiceChannels", joinedVoiceChannel, "candidates");
  }, [db, joinedVoiceChannel]);

  const { data: remoteCandidates } = useCollection(candidatesQuery);

  const setupPeerConnection = useCallback(() => {
    const pc = createPeerConnection();
    if (!pc) return null;

    pc.onconnectionstatechange = () => {
      console.log("peer state:", pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ice state:", pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log("signaling state:", pc.signalingState);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || !db || !joinedVoiceChannel) return;

      console.log("ICE gönderildi");
      saveIceCandidate(db, joinedVoiceChannel, userId, event.candidate);
    };

    pc.ontrack = (event) => {
      console.log("remote stream geldi");

      const remoteStream = event.streams[0];
      if (!remoteStream) {
        console.log("remote stream boş geldi");
        return;
      }

      let audio = remoteAudioRef.current;

      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.display = "none";
        document.body.appendChild(audio);
        remoteAudioRef.current = audio;
      }

      audio.srcObject = remoteStream;

      audio
        .play()
        .then(() => console.log("remote audio oynatılıyor"))
        .catch((error) => console.error("Uzak ses oynatılamadı:", error));
    };

    return pc;
  }, [db, joinedVoiceChannel, userId]);

  const getOrCreatePeerConnection = useCallback(() => {
    if (peerConnectionRef.current) return peerConnectionRef.current;

    const pc = setupPeerConnection();
    if (!pc) return null;

    if (localStreamRef.current) {
      addLocalTracks(pc, localStreamRef.current);
    }

    peerConnectionRef.current = pc;
    return pc;
  }, [setupPeerConnection]);

  // Presence sync
  useEffect(() => {
    if (!db || !joinedVoiceChannel || !userId) return;

    const presenceRef = doc(db, "voiceChannels", joinedVoiceChannel, "presence", userId);

    setDocumentNonBlocking(
      presenceRef,
      {
        userId,
        displayName: userName,
        channelId: joinedVoiceChannel,
        joinedAt: serverTimestamp(),
        isMuted,
      },
      { merge: true }
    );

    return () => {
      deleteDocumentNonBlocking(presenceRef);
    };
  }, [db, joinedVoiceChannel, userId, userName, isMuted]);

  // Create offer when another user is in the same voice channel
  useEffect(() => {
    const createOfferIfNeeded = async () => {
      if (!db || !joinedVoiceChannel || !channelUsers || !localStreamRef.current) return;
      if (offerSentRef.current) return;

      const otherUsers = channelUsers.filter((u) => u.userId !== userId);
      if (otherUsers.length === 0) return;

      const pc = getOrCreatePeerConnection();
      if (!pc) return;

      if (pc.signalingState !== "stable") {
        console.log("Offer oluşturulmadı, state:", pc.signalingState);
        return;
      }

      const offer = await createOffer(pc);
      if (!offer) return;

      console.log("offer oluşturuldu");

      const offersRef = collection(db, "voiceChannels", joinedVoiceChannel, "offers");

      addDocumentNonBlocking(offersRef, {
        userId,
        displayName: userName,
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
        createdAt: serverTimestamp(),
      });

      offerSentRef.current = true;
    };

    createOfferIfNeeded();
  }, [db, joinedVoiceChannel, channelUsers, userId, userName, getOrCreatePeerConnection]);

  // Handle incoming offers
  useEffect(() => {
    const processOffers = async () => {
      if (!offers || !db || !joinedVoiceChannel || !localStreamRef.current) return;

      for (const offerDoc of offers) {
        if (offerDoc.userId === userId) continue;
        if (processedOffersRef.current.has(offerDoc.id)) continue;

        console.log("offer alındı:", offerDoc.displayName);

        const pc = getOrCreatePeerConnection();
        if (!pc) continue;

        if (pc.signalingState !== "stable") {
          console.log("Offer atlandı, state:", pc.signalingState);
          processedOffersRef.current.add(offerDoc.id);
          continue;
        }

        const answer = await createAnswer(pc, offerDoc.offer);
        if (!answer) continue;

        console.log("answer oluşturuldu");

        const answersRef = collection(db, "voiceChannels", joinedVoiceChannel, "answers");

        addDocumentNonBlocking(answersRef, {
          userId,
          targetUserId: offerDoc.userId,
          displayName: userName,
          answer: {
            type: answer.type,
            sdp: answer.sdp,
          },
          createdAt: serverTimestamp(),
        });

        processedOffersRef.current.add(offerDoc.id);
      }
    };

    processOffers();
  }, [offers, db, joinedVoiceChannel, userId, userName, getOrCreatePeerConnection]);

  // Handle incoming answers
  useEffect(() => {
    const processAnswers = async () => {
      if (!answers || !peerConnectionRef.current) return;

      const pc = peerConnectionRef.current;

      for (const answerDoc of answers) {
        if (answerDoc.targetUserId !== userId) continue;
        if (processedAnswersRef.current.has(answerDoc.id)) continue;

        if (pc.signalingState === "have-local-offer") {
          console.log("answer alındı");

          await setRemoteDescription(pc, answerDoc.answer);

          processedAnswersRef.current.add(answerDoc.id);
          console.log("answer uygulandı");
        } else {
          console.log("answer atlandı, state:", pc.signalingState);
          processedAnswersRef.current.add(answerDoc.id);
        }
      }
    };

    processAnswers();
  }, [answers, userId]);

  // Handle incoming ICE candidates
  useEffect(() => {
    const processCandidates = async () => {
      if (!remoteCandidates || !peerConnectionRef.current) return;

      const pc = peerConnectionRef.current;

      for (const candidateDoc of remoteCandidates) {
        if (candidateDoc.userId === userId) continue;
        if (processedCandidatesRef.current.has(candidateDoc.id)) continue;

        try {
          console.log("ICE alındı");

          await addIceCandidate(pc, candidateDoc.candidate);

          processedCandidatesRef.current.add(candidateDoc.id);
          console.log("ICE eklendi");
        } catch (err) {
          console.error("ICE adayı ekleme hatası:", err);
        }
      }
    };

    processCandidates();
  }, [remoteCandidates, userId]);

  const handleJoinVoiceChannel = useCallback(
    async (channel: string) => {
      if (joinedVoiceChannel === channel) return;
      if (!db) return;

      if (peerConnectionRef.current) {
        closePeerConnection(peerConnectionRef.current);
        peerConnectionRef.current = null;
      }

      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      processedOffersRef.current.clear();
      processedAnswersRef.current.clear();
      processedCandidatesRef.current.clear();
      offerSentRef.current = false;

      try {
        const stream = await getLocalAudioStream();
        if (!stream) throw new Error("Mikrofon akışı alınamadı.");

        localStreamRef.current = stream;

        const pc = setupPeerConnection();
        if (pc) {
          addLocalTracks(pc, stream);
          peerConnectionRef.current = pc;
        }

        setJoinedVoiceChannel(channel);
        setIsMuted(false);

        toast({
          title: "Sesli Kanala Katılındı",
          description: `${channel} kanalına bağlandınız.`,
        });
      } catch (error) {
        console.error("Ses bağlantı hatası:", error);

        toast({
          variant: "destructive",
          title: "Bağlantı Hatası",
          description: "Sesli kanala katılmak için mikrofon izni vermeniz gerekiyor.",
        });
      }
    },
    [toast, joinedVoiceChannel, db, setupPeerConnection]
  );

  const handleLeaveVoiceChannel = useCallback(() => {
    if (peerConnectionRef.current) {
      closePeerConnection(peerConnectionRef.current);
      peerConnectionRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.remove();
      remoteAudioRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    processedOffersRef.current.clear();
    processedAnswersRef.current.clear();
    processedCandidatesRef.current.clear();
    offerSentRef.current = false;

    setJoinedVoiceChannel(null);
    setIsSpeaking(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;

    const newMuteState = !isMuted;

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !newMuteState;
    });

    setIsMuted(newMuteState);
    if (newMuteState) setIsSpeaking(false);
  }, [isMuted]);

  useEffect(() => {
    return () => {
      if (peerConnectionRef.current) closePeerConnection(peerConnectionRef.current);

      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

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
              <p className="max-w-xs mt-2 italic text-sm">
                Burası {activeRoom} odası. Henüz mesaj yok.
              </p>
            </div>
          </div>

          <aside className="w-60 bg-black/10 border-l border-black/5 hidden lg:block">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-6">
                <div>
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-3">
                    {joinedVoiceChannel
                      ? `${joinedVoiceChannel} — ${channelUsers?.length || 0}`
                      : "Çevrimiçi — 1"}
                  </h3>

                  <div className="space-y-1">
                    {joinedVoiceChannel && channelUsers ? (
                      channelUsers.map((u) => {
                        const isThisUser = u.userId === userId;

                        return (
                          <div
                            key={u.id}
                            className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group"
                          >
                            <div className="relative">
                              <div
                                className={cn(
                                  "w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-xs transition-all duration-200",
                                  isThisUser &&
                                    isSpeaking &&
                                    "ring-2 ring-green-500 ring-offset-2 ring-offset-[#312B38]"
                                )}
                              >
                                {u.displayName.charAt(0).toUpperCase()}
                              </div>

                              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full" />
                            </div>

                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-medium text-accent truncate">
                                {u.displayName}
                              </span>
                              <span className="text-[10px] text-muted-foreground truncate leading-none">
                                {u.isMuted ? "Susturuldu" : "Sesli"}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group">
                        <div className="relative">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-xs transition-all duration-200",
                              isSpeaking &&
                                "ring-2 ring-green-500 ring-offset-2 ring-offset-[#312B38]"
                            )}
                          >
                            {userName.charAt(0).toUpperCase()}
                          </div>

                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full" />
                        </div>

                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-accent truncate">
                            {userName}
                          </span>
                          <span className="text-[11px] text-muted-foreground leading-none">
                            Çevrimiçi
                          </span>
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
