
"use client"

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Hash, LogOut, Mic, MicOff, PhoneOff, UserCircle2, Volume2, Headphones, Settings, VolumeX, Volume1, UserMinus, Plus, Trash2, ShieldCheck, Shield, Monitor, MonitorOff, Camera, CameraOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserRole } from '@/app/page';

interface RoomSidebarProps {
  rooms: string[];
  voiceChannels: string[];
  activeRoom: string;
  onRoomSelect: (room: string) => void;
  userName: string;
  userId: string;
  userRole: UserRole;
  onLogout: () => void;
  joinedVoiceChannel: string | null;
  onJoinVoice: (channel: string) => void;
  onLeaveVoice: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isDeafened: boolean;
  onToggleDeafen: () => void;
  isSpeaking?: boolean;
  isScreenSharing: boolean;
  onToggleScreenShare: () => void;
  isCameraOn: boolean;
  onToggleCamera: () => void;
  onOpenSettings: () => void;
  userVolumes: Record<string, number>;
  onVolumeChange: (userId: string, volume: number) => void;
  onKickUser: (userId: string) => void;
  onAddChannel: () => void;
  onDeleteChannel: (id: string, type: "text" | "voice") => void;
}

function ChannelUserList({ channelId, currentUserId, userRole, userVolumes, onVolumeChange, onKickUser }: { 
  channelId: string, 
  currentUserId: string,
  userRole: UserRole,
  userVolumes: Record<string, number>,
  onVolumeChange: (userId: string, volume: number) => void,
  onKickUser: (userId: string) => void
}) {
  const db = useFirestore();
  const q = useMemoFirebase(() => db ? collection(db, 'voiceChannels', channelId, 'presence') : null, [db, channelId]);
  const { data: rawUsers } = useCollection(q);

  const activeUsers = useMemo(() => {
    if (!rawUsers) return [];
    const now = Date.now();
    return rawUsers.filter(u => u.lastSeen && (now - new Date(u.lastSeen).getTime() < 15000));
  }, [rawUsers]);

  if (activeUsers.length === 0) return null;

  const canKick = userRole === 'admin' || userRole === 'mod';

  return (
    <div className="ml-4 space-y-0.5 mt-1">
      {activeUsers.map((u) => {
        const isMe = u.userId === currentUserId;
        const volume = userVolumes[u.userId] ?? 100;
        return (
          <div key={u.id} className="flex items-center justify-between group/user py-0.5 px-2 rounded hover:bg-white/5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-accent-foreground shrink-0">{u.displayName.charAt(0)}</div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm text-sidebar-foreground/80 font-medium truncate max-w-[80px]">{u.displayName}</span>
                <div className="flex gap-1">
                  {u.isSharingScreen && (
                    <span className="flex items-center gap-1 bg-primary/20 text-primary text-[8px] font-bold px-1 py-0.2 rounded leading-none w-fit border border-primary/30 uppercase">
                      <Monitor className="w-2 h-2" />
                    </span>
                  )}
                  {u.isCameraOn && (
                    <span className="flex items-center gap-1 bg-green-500/20 text-green-500 text-[8px] font-bold px-1 py-0.2 rounded leading-none w-fit border border-green-500/30 uppercase">
                      <Camera className="w-2 h-2" />
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {u.isMuted && <MicOff className="w-3 h-3 text-destructive" />}
              {!isMe && (
                <div className="flex items-center gap-1 opacity-0 group-hover/user:opacity-100 transition-opacity">
                  {canKick && (
                    <button onClick={() => onKickUser(u.userId)} className="text-destructive hover:text-red-400 p-0.5"><UserMinus className="w-3 h-3" /></button>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-muted-foreground hover:text-foreground p-0.5">{volume === 0 ? <VolumeX className="w-3 h-3" /> : <Volume1 className="w-3 h-3" />}</button>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-40 p-3 bg-card border-border">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-bold"><span>Ses</span><span>%{volume}</span></div>
                        <Slider value={[volume]} max={100} onValueChange={(v) => onVolumeChange(u.userId, v[0])} />
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RoomSidebar({ 
  rooms, voiceChannels, activeRoom, onRoomSelect, userName, userId, userRole, onLogout, 
  joinedVoiceChannel, onJoinVoice, onLeaveVoice, isMuted, onToggleMute, isDeafened, onToggleDeafen, 
  isSpeaking, isScreenSharing, onToggleScreenShare, isCameraOn, onToggleCamera, onOpenSettings, userVolumes, onVolumeChange, onKickUser, onAddChannel, onDeleteChannel 
}: RoomSidebarProps) {
  const isAdmin = userRole === 'admin';

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border w-64 shrink-0">
        <div className="h-14 flex items-center justify-between px-4 border-b border-sidebar-border">
          <h2 className="font-bold text-lg text-sidebar-foreground tracking-tight">haruncord</h2>
          {isAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={onAddChannel}>
                  <Plus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Kanal Ekle</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <div className="text-[11px] font-bold text-muted-foreground uppercase px-2 mb-2 tracking-wider flex justify-between items-center">
              <span>Metin Kanalları</span>
            </div>
            <div className="space-y-0.5">
              {rooms.map((room) => (
                <div key={room} className="group flex items-center">
                  <Button
                    variant="ghost"
                    onClick={() => onRoomSelect(room)}
                    className={cn(
                      "w-full justify-start gap-2 h-9 px-2 font-medium transition-all",
                      activeRoom === room ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <Hash className="w-4 h-4" />
                    <span className="truncate">{room}</span>
                  </Button>
                  {isAdmin && room !== "Genel" && (
                    <button onClick={() => onDeleteChannel(room, "text")} className="opacity-0 group-hover:opacity-100 p-2 text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-muted-foreground uppercase px-2 mb-2 tracking-wider">Ses Kanalları</div>
            <div className="space-y-1">
              {voiceChannels.map((channel) => (
                <div key={channel} className="space-y-0.5">
                  <div className="group flex items-center">
                    <Button
                      variant="ghost"
                      onClick={() => onJoinVoice(channel)}
                      className={cn(
                        "w-full justify-start gap-2 h-9 px-2 font-medium transition-all",
                        joinedVoiceChannel === channel || activeRoom === channel ? "text-sidebar-accent-foreground bg-sidebar-accent/20" : "text-muted-foreground hover:bg-sidebar-accent/50"
                      )}
                    >
                      <Volume2 className={cn("w-4 h-4", joinedVoiceChannel === channel ? "text-green-500" : "text-muted-foreground")} />
                      <span className="truncate">{channel}</span>
                    </Button>
                    {isAdmin && channel !== "Genel Ses" && (
                      <button onClick={() => onDeleteChannel(channel, "voice")} className="opacity-0 group-hover:opacity-100 p-2 text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                    )}
                  </div>
                  <ChannelUserList channelId={channel} currentUserId={userId} userRole={userRole} userVolumes={userVolumes} onVolumeChange={onVolumeChange} onKickUser={onKickUser} />
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
                <div className="text-[11px] text-muted-foreground font-medium truncate max-w-[100px]">{joinedVoiceChannel}</div>
              </div>
              <div className="flex gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className={cn("h-8 w-8", isCameraOn ? "text-green-500" : "text-muted-foreground")} onClick={onToggleCamera}>
                      {isCameraOn ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isCameraOn ? 'Kamerayı Kapat' : 'Kamerayı Aç'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className={cn("h-8 w-8", isScreenSharing ? "text-primary" : "text-muted-foreground")} onClick={onToggleScreenShare}>
                      {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isScreenSharing ? 'Paylaşımı Durdur' : 'Ekran Paylaş'}</TooltipContent>
                </Tooltip>
                <Button variant="ghost" size="icon" className={cn("h-8 w-8", isMuted ? "text-destructive" : "text-muted-foreground")} onClick={onToggleMute}>
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="icon" className={cn("h-8 w-8", isDeafened ? "text-destructive" : "text-muted-foreground")} onClick={onToggleDeafen}>
                  <Headphones className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={onLeaveVoice}>
                  <PhoneOff className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-black/20 p-2 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative shrink-0">
              <UserCircle2 className={cn("w-8 h-8 text-accent", isSpeaking && "ring-2 ring-green-500 ring-offset-2 ring-offset-[#1F1A26] rounded-full")} />
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#1F1A26] rounded-full" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-sm font-bold text-foreground truncate">{userName}</span>
                {userRole === 'admin' ? <ShieldCheck className="w-3 h-3 text-primary" /> : userRole === 'mod' ? <Shield className="w-3 h-3 text-accent" /> : null}
              </div>
              <span className="text-[10px] text-muted-foreground leading-none uppercase tracking-tighter">{userRole === 'admin' ? 'Admin' : userRole === 'mod' ? 'Mod' : 'Üye'}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-white/5" onClick={onOpenSettings}><Settings className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-white/5" onClick={onLogout}><LogOut className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
