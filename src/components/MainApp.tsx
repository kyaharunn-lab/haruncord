
"use client"

import { useState, useEffect, useCallback, useRef } from 'react';
import { RoomSidebar } from './RoomSidebar';
import { Hash, MessageSquare } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface MainAppProps {
  userName: string;
  onLogout: () => void;
}

export function MainApp({ userName, onLogout }: MainAppProps) {
  const rooms = ['Genel', 'Oyun', 'Muhabbet'];
  const voiceChannels = ['Genel Ses', 'Oyun Ses', 'Muhabbet Ses'];
  
  const [activeRoom, setActiveRoom] = useState(rooms[0]);
  const [joinedVoiceChannel, setJoinedVoiceChannel] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  
  const localStreamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  const handleJoinVoiceChannel = useCallback(async (channel: string) => {
    // If already in a channel, leave it first
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }, 
        video: false 
      });
      
      localStreamRef.current = stream;
      setHasMicPermission(true);
      setJoinedVoiceChannel(channel);
      setIsMuted(false); // Reset mute state on new join
      
      toast({
        title: 'Sesli Kanala Katılındı',
        description: `${channel} kanalına bağlandınız.`,
      });
    } catch (error) {
      console.error('Microphone access denied:', error);
      setHasMicPermission(false);
      toast({
        variant: 'destructive',
        title: 'Mikrofon Erişimi Reddedildi',
        description: 'Sesli kanala katılmak için mikrofon izni vermeniz gerekiyor.',
      });
    }
  }, [toast]);

  const handleLeaveVoiceChannel = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setJoinedVoiceChannel(null);
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const newMuteState = !isMuted;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newMuteState;
      });
      setIsMuted(newMuteState);
    }
  }, [isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <RoomSidebar 
        rooms={rooms} 
        voiceChannels={voiceChannels}
        activeRoom={activeRoom} 
        onRoomSelect={setActiveRoom} 
        userName={userName}
        onLogout={onLogout}
        joinedVoiceChannel={joinedVoiceChannel}
        onJoinVoice={handleJoinVoiceChannel}
        onLeaveVoice={handleLeaveVoiceChannel}
        isMuted={isMuted}
        onToggleMute={toggleMute}
      />
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#312B38]">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-black/10 shadow-sm bg-card/20">
          <div className="flex items-center gap-2 font-semibold">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <span className="text-foreground">{activeRoom}</span>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Messages Area placeholder */}
          <div className="flex-1 flex flex-col p-6 space-y-4">
            <div className="flex flex-col items-center justify-center flex-1 text-center opacity-40">
              <div className="p-6 bg-black/10 rounded-full mb-4">
                <MessageSquare className="w-16 h-16" />
              </div>
              <h2 className="text-2xl font-bold">Hoş geldin, {userName}!</h2>
              <p className="max-w-xs mt-2 italic text-sm">Burası {activeRoom} odası. Henüz mesaj yok, ilk sen bir şeyler söyleyebilirsin.</p>
            </div>
          </div>

          {/* Online Users Sidebar */}
          <aside className="w-60 bg-black/10 border-l border-black/5 hidden lg:block">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-6">
                <div>
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-3">Çevrimiçi — 1</h3>
                  <div className="space-y-1">
                    {/* Current User */}
                    <div className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold">
                          {userName.charAt(0).toUpperCase()}
                        </div>
                        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full"></div>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-accent truncate">{userName}</span>
                        <span className="text-[10px] text-muted-foreground truncate leading-none">Çevrimiçi</span>
                      </div>
                    </div>
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
