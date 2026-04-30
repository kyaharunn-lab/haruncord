
"use client"

import { Button } from '@/components/ui/button';
import { Hash, LogOut, Mic, MicOff, PhoneOff, UserCircle2, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';

interface RoomSidebarProps {
  rooms: string[];
  voiceChannels: string[];
  activeRoom: string;
  onRoomSelect: (room: string) => void;
  userName: string;
  userId: string;
  onLogout: () => void;
  joinedVoiceChannel: string | null;
  onJoinVoice: (channel: string) => void;
  onLeaveVoice: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

function ChannelUserList({ channelId }: { channelId: string }) {
  const db = useFirestore();
  const q = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'voiceChannels', channelId, 'presence');
  }, [db, channelId]);
  
  const { data: users } = useCollection(q);

  if (!users || users.length === 0) return null;

  return (
    <div className="ml-4 space-y-0.5 mt-1">
      {users.map((user) => (
        <div key={user.userId} className="flex items-center justify-between group/user py-0.5 px-2 rounded hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-accent-foreground">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm text-sidebar-foreground/80 font-medium truncate max-w-[100px]">{user.displayName}</span>
          </div>
          {user.isMuted && <MicOff className="w-3 h-3 text-destructive" />}
        </div>
      ))}
    </div>
  );
}

export function RoomSidebar({ 
  rooms, 
  voiceChannels,
  activeRoom, 
  onRoomSelect, 
  userName, 
  userId,
  onLogout,
  joinedVoiceChannel,
  onJoinVoice,
  onLeaveVoice,
  isMuted,
  onToggleMute
}: RoomSidebarProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border w-64">
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border shadow-sm">
          <h2 className="font-bold text-lg text-sidebar-foreground tracking-tight truncate">haruncord</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <div className="text-[11px] font-bold text-muted-foreground uppercase px-2 mb-2 tracking-wider">Metin Kanalları</div>
            <div className="space-y-1">
              {rooms.map((room) => (
                <Button
                  key={room}
                  variant="ghost"
                  onClick={() => onRoomSelect(room)}
                  className={cn(
                    "w-full justify-start gap-2 h-9 px-2 font-medium transition-all group",
                    activeRoom === room 
                      ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Hash className={cn("w-4 h-4", activeRoom === room ? "text-sidebar-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground")} />
                  {room}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-muted-foreground uppercase px-2 mb-2 tracking-wider">Ses Kanalları</div>
            <div className="space-y-1">
              {voiceChannels.map((channel) => (
                <div key={channel} className="space-y-1">
                  <Button
                    variant="ghost"
                    onClick={() => onJoinVoice(channel)}
                    className={cn(
                      "w-full justify-start gap-2 h-9 px-2 font-medium transition-all group",
                      joinedVoiceChannel === channel 
                        ? "text-sidebar-accent-foreground" 
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Volume2 className={cn("w-4 h-4", joinedVoiceChannel === channel ? "text-green-500" : "text-muted-foreground group-hover:text-sidebar-foreground")} />
                    {channel}
                  </Button>
                  
                  <ChannelUserList channelId={channel} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {joinedVoiceChannel && (
          <div className="bg-black/10 border-t border-sidebar-border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <div className="flex items-center gap-1 text-green-500 text-xs font-bold leading-none mb-1">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Ses Bağlandı
                </div>
                <div className="text-[11px] text-muted-foreground font-medium">{joinedVoiceChannel}</div>
              </div>
              <div className="flex gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className={cn("h-8 w-8", isMuted ? "text-destructive hover:text-destructive" : "text-muted-foreground hover:text-foreground")}
                      onClick={onToggleMute}
                    >
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={onLeaveVoice}
                    >
                      <PhoneOff className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Ses Kanalından Çık
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        )}

        <div className="bg-black/20 p-2 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative">
              <UserCircle2 className="w-8 h-8 text-accent" />
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#1F1A26] rounded-full"></div>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-foreground truncate">{userName}</span>
              <span className="text-[11px] text-muted-foreground leading-none">Çevrimiçi</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-white/5"
                  onClick={onLogout}
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Çıkış Yap</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
