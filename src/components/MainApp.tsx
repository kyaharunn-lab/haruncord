
"use client"

import { useState, useEffect, useCallback, useRef } from 'react';
import { RoomSidebar } from './RoomSidebar';
import { Hash, MessageSquare } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { setDocumentNonBlocking, deleteDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { getLocalAudioStream, createPeerConnection, addLocalTracks, closePeerConnection, createOffer, createAnswer, setRemoteDescription, addIceCandidate } from '@/lib/webrtc';

interface MainAppProps {
  userName: string;
  userId: string;
  onLogout: () => void;
}

export function MainApp({ userName, userId, onLogout }: MainAppProps) {
  const rooms = ['Genel', 'Oyun', 'Muhabbet'];
  const voiceChannels = ['Genel Ses', 'Oyun Ses', 'Muhabbet Ses'];
  
  const [activeRoom, setActiveRoom] = useState(rooms[0]);
  const [joinedVoiceChannel, setJoinedVoiceChannel] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const { toast } = useToast();
  const db = useFirestore();
  const { user } = useUser();

  // Voice Activity Detection (VAD)
  useEffect(() => {
    if (!localStreamRef.current || isMuted || !joinedVoiceChannel) {
      setIsSpeaking(false);
      return;
    }

    let audioContext: AudioContext;
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;
    let animationId: number;
    let lastSpeakState = false;

    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      source = audioContext.createMediaStreamSource(localStreamRef.current);
      source.connect(analyser);
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const speaking = average > 15; // Ses eşiği

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

  // Presence Query
  const activePresenceQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel || !user) return null;
    return collection(db, 'voiceChannels', joinedVoiceChannel, 'presence');
  }, [db, joinedVoiceChannel, user]);

  const { data: channelUsers } = useCollection(activePresenceQuery);

  // Offers Query (Signaling)
  const offersQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel || !user) return null;
    return collection(db, 'voiceChannels', joinedVoiceChannel, 'offers');
  }, [db, joinedVoiceChannel, user]);

  const { data: offers } = useCollection(offersQuery);

  // Answers Query (Signaling)
  const answersQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel || !user) return null;
    return collection(db, 'voiceChannels', joinedVoiceChannel, 'answers');
  }, [db, joinedVoiceChannel, user]);

  const { data: answers } = useCollection(answersQuery);

  // Candidates Query (Signaling)
  const candidatesQuery = useMemoFirebase(() => {
    if (!db || !joinedVoiceChannel || !user) return null;
    return collection(db, 'voiceChannels', joinedVoiceChannel, 'candidates');
  }, [db, joinedVoiceChannel, user]);

  const { data: remoteCandidates } = useCollection(candidatesQuery);

  // Helper to setup a peer connection with ontrack handler
  const setupPeerConnection = useCallback(() => {
    const pc = createPeerConnection();
    if (pc) {
      pc.ontrack = (event) => {
        console.log('remote stream geldi');
        const remoteStream = event.streams[0];
        if (remoteStream) {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          (audio as any).playsInline = true;
          audio.play().catch(e => console.error("Uzak ses oynatılamadı:", e));
        }
      };
    }
    return pc;
  }, []);

  // Presence sync
  useEffect(() => {
    if (!db || !joinedVoiceChannel || !user || !userId) return;

    const presenceRef = doc(db, 'voiceChannels', joinedVoiceChannel, 'presence', userId);
    
    setDocumentNonBlocking(presenceRef, {
      userId,
      displayName: userName,
      channelId: joinedVoiceChannel,
      joinedAt: serverTimestamp(),
      isMuted: isMuted
    }, { merge: true });

    return () => {
      deleteDocumentNonBlocking(presenceRef);
    };
  }, [db, joinedVoiceChannel, userId, userName, isMuted, user]);

  // Handle Incoming Offers (Answer Generation)
  useEffect(() => {
    if (!offers || offers.length === 0 || !userId || !db || !joinedVoiceChannel) return;

    const processOffers = async () => {
      for (const offerDoc of offers) {
        if (offerDoc.userId !== userId && !processedIdsRef.current.has(offerDoc.id)) {
          console.log('offer bulundu:', offerDoc.displayName);
          
          if (localStreamRef.current) {
            let pc = peerConnectionRef.current;
            if (!pc) {
              pc = setupPeerConnection();
              peerConnectionRef.current = pc;
            }
            
            if (pc && pc.signalingState !== 'closed') {
              try {
                addLocalTracks(pc, localStreamRef.current);
                const answer = await createAnswer(pc, offerDoc.offer);
                if (answer) {
                  console.log('answer hazır');
                  const answersRef = collection(db, 'voiceChannels', joinedVoiceChannel, 'answers');
                  addDocumentNonBlocking(answersRef, {
                    userId,
                    targetUserId: offerDoc.userId,
                    displayName: userName,
                    answer: {
                      type: answer.type,
                      sdp: answer.sdp
                    },
                    createdAt: serverTimestamp()
                  });
                  processedIdsRef.current.add(offerDoc.id);
                }
              } catch (err) {
                console.error('Offer işleme hatası:', err);
              }
            }
          }
        }
      }
    };

    processOffers();
  }, [offers, userId, db, joinedVoiceChannel, userName, setupPeerConnection]);

  // Handle Incoming Answers (Connection Completion)
  useEffect(() => {
    if (!answers || answers.length === 0 || !userId || !peerConnectionRef.current) return;

    const processAnswers = async () => {
      const pc = peerConnectionRef.current;
      if (!pc) return;

      for (const answerDoc of answers) {
        if (answerDoc.targetUserId === userId) {
          if (processedIdsRef.current.has(answerDoc.id)) {
            continue;
          }

          if (pc.signalingState === 'stable') {
            processedIdsRef.current.add(answerDoc.id);
            continue;
          }

          if (pc.signalingState !== 'have-local-offer') {
            continue;
          }

          try {
            console.log('answer bulundu, bağlantı kuruluyor...');
            await setRemoteDescription(pc, answerDoc.answer);
            processedIdsRef.current.add(answerDoc.id);
            console.log('answer uygulandı');
            console.log('bağlantı kuruldu');
          } catch (err) {
            console.error('Answer uygulama hatası:', err);
          }
        }
      }
    };

    processAnswers();
  }, [answers, userId]);

  // Handle Incoming ICE Candidates
  useEffect(() => {
    if (!remoteCandidates || remoteCandidates.length === 0 || !userId || !peerConnectionRef.current) return;

    const processCandidates = async () => {
      const pc = peerConnectionRef.current;
      if (!pc || !pc.remoteDescription) return;

      for (const candidateDoc of remoteCandidates) {
        if (candidateDoc.userId !== userId && !processedIdsRef.current.has(candidateDoc.id)) {
          try {
            console.log('ICE eklendi');
            await addIceCandidate(pc, candidateDoc.candidate);
            processedIdsRef.current.add(candidateDoc.id);
          } catch (err) {
            console.error('ICE adayı ekleme hatası:', err);
          }
        }
      }
    };

    processCandidates();
  }, [remoteCandidates, userId]);

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    if (joinedVoiceChannel === channel) return;
    if (!db) return;

    // Cleanup
    if (peerConnectionRef.current) {
      closePeerConnection(peerConnectionRef.current);
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    processedIdsRef.current.clear();

    try {
      const stream = await getLocalAudioStream();
      if (!stream) throw new Error("Mikrofon akışı alınamadı.");
      
      localStreamRef.current = stream;
      
      const pc = setupPeerConnection();
      if (pc) {
        addLocalTracks(pc, stream);
        peerConnectionRef.current = pc;

        // If others are in channel, create an offer
        if (channelUsers && channelUsers.length > 1) {
          const offer = await createOffer(pc);
          if (offer) {
            console.log('offer hazır');
            const offersRef = collection(db, 'voiceChannels', channel, 'offers');
            addDocumentNonBlocking(offersRef, {
              userId,
              displayName: userName,
              offer: {
                type: offer.type,
                sdp: offer.sdp
              },
              createdAt: serverTimestamp()
            });
          }
        }
      }
      
      setJoinedVoiceChannel(channel);
      setIsMuted(false);
      
      toast({
        title: 'Sesli Kanala Katılındı',
        description: `${channel} kanalına bağlandınız.`,
      });
    } catch (error) {
      console.error('Ses bağlantı hatası:', error);
      toast({
        variant: 'destructive',
        title: 'Bağlantı Hatası',
        description: 'Sesli kanala katılmak için mikrofon izni vermeniz gerekiyor.',
      });
    }
  }, [toast, joinedVoiceChannel, channelUsers, db, userId, userName, setupPeerConnection]);

  const handleLeaveVoiceChannel = useCallback(() => {
    if (peerConnectionRef.current) {
      closePeerConnection(peerConnectionRef.current);
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    processedIdsRef.current.clear();
    setJoinedVoiceChannel(null);
    setIsSpeaking(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const newMuteState = !isMuted;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newMuteState;
      });
      setIsMuted(newMuteState);
      if (newMuteState) setIsSpeaking(false);
    }
  }, [isMuted]);

  useEffect(() => {
    return () => {
      if (peerConnectionRef.current) closePeerConnection(peerConnectionRef.current);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
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
              <p className="max-w-xs mt-2 italic text-sm">Burası {activeRoom} odası. Henüz mesaj yok.</p>
            </div>
          </div>

          <aside className="w-60 bg-black/10 border-l border-black/5 hidden lg:block">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-6">
                <div>
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-3">
                    {joinedVoiceChannel ? `${joinedVoiceChannel} — ${channelUsers?.length || 0}` : `Çevrimiçi — 1`}
                  </h3>
                  <div className="space-y-1">
                    {joinedVoiceChannel && channelUsers ? (
                      channelUsers.map((u) => {
                        const isThisUser = u.userId === userId;
                        return (
                          <div key={u.id} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group">
                            <div className="relative">
                              <div className={cn(
                                "w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-xs transition-all duration-200",
                                isThisUser && isSpeaking && "ring-2 ring-green-500 ring-offset-2 ring-offset-[#312B38]"
                              )}>
                                {u.displayName.charAt(0).toUpperCase()}
                              </div>
                              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full"></div>
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-medium text-accent truncate">{u.displayName}</span>
                              <span className="text-[10px] text-muted-foreground truncate leading-none">
                                {u.isMuted ? 'Susturuldu' : 'Sesli'}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group">
                        <div className="relative">
                          <div className={cn(
                            "w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-xs transition-all duration-200",
                            isSpeaking && "ring-2 ring-green-500 ring-offset-2 ring-offset-[#312B38]"
                          )}>
                            {userName.charAt(0).toUpperCase()}
                          </div>
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full"></div>
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
