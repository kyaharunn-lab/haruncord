
"use client"

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Hash, 
  LogOut, 
  Mic, 
  MicOff, 
  PhoneOff, 
  Volume2, 
  Headphones, 
  Settings, 
  VolumeX, 
  Volume1, 
  ShieldCheck, 
  Shield, 
  Settings2,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserRole } from '@/app/page';

type ConnectionQuality = "excellent" | "good" | "poor" | "reconnecting";

const qualityShortLabels: Record<ConnectionQuality, string> = {
  excellent: "mük",
  good: "iyi",
  poor: "zayıf",
  reconnecting: "yen",
};

interface RoomSidebarProps {
  className?: string;
  rooms: string[];
  voiceChannels: string[];
  activeRoom: string;
  onRoomSelect: (room: string) => void;
  userName: string;
  userId: string;
  userRole: UserRole;
  onLogout: () => void;
  joinedVoiceChannel: string | null;
  joinedVoiceUserCount: number;
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
  onOpenAdminPanel: () => void;
  peerQuality: Record<string, ConnectionQuality>;
  userVolumes: Record<string, number>;
  onVolumeChange: (userId: string, volume: number) => void;
  onKickUser: (userId: string) => void;
  onAddChannel: () => void;
  onDeleteChannel: (id: string, type: "text" | "voice") => void;
}

function ChannelUserList({ channelId, currentUserId, userRole, userVolumes, peerQuality, onVolumeChange, onKickUser }: { 
  channelId: string, 
  currentUserId: string,
  userRole: UserRole,
  userVolumes: Record<string, number>,
  peerQuality: Record<string, ConnectionQuality>,
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

  return (
    <div className="ml-4 mt-1.5 space-y-1 border-l border-white/8 pl-2">
      {activeUsers.map((u) => {
        const isMe = u.userId === currentUserId;
        const volume = userVolumes[u.userId] ?? 100;
        const initial = (u.displayName || "?").charAt(0).toUpperCase();
        const quality = isMe ? "excellent" : (peerQuality[u.userId] ?? "good");
        return (
          <div key={u.id} className="group/user flex items-center justify-between rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.055]">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn(
                "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-[10px] font-bold text-white",
                u.isSpeaking && "ring-2 ring-emerald-400/70"
              )}>
                {initial}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#15131d] bg-emerald-400" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="max-w-[120px] truncate text-sm font-medium text-white/78">{u.displayName}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className={cn(
                "hidden rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider sm:inline-flex",
                quality === "excellent" ? "bg-emerald-400/10 text-emerald-200" :
                quality === "good" ? "bg-sky-400/10 text-sky-200" :
                quality === "poor" ? "bg-red-400/10 text-red-200" :
                "bg-amber-400/10 text-amber-200"
              )}>
                {qualityShortLabels[quality]}
              </span>
              {u.isMuted && <MicOff className="w-3.5 h-3.5 text-red-300" />}
              {!isMe && (
                <div className="flex items-center gap-1 opacity-0 group-hover/user:opacity-100 transition-opacity">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white" aria-label="Kullanici ses seviyesi">{volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume1 className="w-3.5 h-3.5" />}</button>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-44 border-white/10 bg-[#17151f] p-3 text-white shadow-2xl">
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
  className,
  rooms, voiceChannels, activeRoom, onRoomSelect, userName, userId, userRole, onLogout, 
  joinedVoiceChannel, joinedVoiceUserCount, onJoinVoice, onLeaveVoice, isMuted, onToggleMute, isDeafened, onToggleDeafen, 
  isSpeaking, isScreenSharing, onToggleScreenShare, isCameraOn, onToggleCamera, onOpenSettings, onOpenAdminPanel, peerQuality, userVolumes, onVolumeChange, onKickUser, onAddChannel, onDeleteChannel 
}: RoomSidebarProps) {
  const isAdmin = userRole === 'admin';

  return (
    <TooltipProvider>
      <div className={cn("flex h-full w-[280px] shrink-0 flex-col border-r border-white/10 bg-[#111019]/95 shadow-2xl shadow-black/30 backdrop-blur-xl md:w-72", className)}>
        <div className="relative h-[72px] shrink-0 overflow-hidden border-b border-white/10 px-4">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent" />
          <div className="flex h-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-300/20 bg-gradient-to-br from-indigo-500/80 to-violet-700/80 shadow-lg shadow-indigo-950/40">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold tracking-tight text-white">haruncord</h2>
                <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">ses merkezi</p>
              </div>
            </div>
            {isAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl border border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white" onClick={onOpenAdminPanel}>
                  <Settings2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Yönetim Paneli</TooltipContent>
            </Tooltip>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          <div>
            <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/35">
              <span>Metin Kanalları</span>
            </div>
            <div className="space-y-1">
              {rooms.map((room) => (
                <div key={room} className="group flex items-center">
                  <Button
                    variant="ghost"
                    onClick={() => onRoomSelect(room)}
                    className={cn(
                      "relative h-10 w-full justify-start gap-2.5 rounded-xl px-3 font-medium transition-all duration-200",
                      activeRoom === room
                        ? "bg-gradient-to-r from-indigo-500/22 to-violet-500/12 text-white shadow-inner"
                        : "text-white/48 hover:bg-white/[0.055] hover:text-white/86"
                    )}
                  >
                    {activeRoom === room && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-300" />}
                    <Hash className={cn("w-4 h-4", activeRoom === room ? "text-indigo-200" : "text-white/35")} />
                    <span className="truncate">{room}</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/35">
              <span>Ses Kanallari</span>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/40">{voiceChannels.length}</span>
            </div>
            <div className="space-y-1">
              {voiceChannels.map((channel) => (
                <div key={channel} className={cn(
                  "space-y-0.5 rounded-2xl p-1 transition-colors",
                  joinedVoiceChannel === channel && "border border-emerald-400/15 bg-emerald-400/[0.035]"
                )}>
                  <div className="group flex items-center">
                    <Button
                      variant="ghost"
                      onClick={() => onJoinVoice(channel)}
                      className={cn(
                        "h-10 w-full justify-start gap-2.5 rounded-xl px-3 font-medium transition-all duration-200",
                        joinedVoiceChannel === channel || activeRoom === channel
                          ? "bg-white/[0.065] text-white"
                          : "text-white/48 hover:bg-white/[0.055] hover:text-white/86"
                      )}
                    >
                      <Volume2 className={cn("w-4 h-4", joinedVoiceChannel === channel ? "text-emerald-300" : "text-white/35")} />
                      <span className="truncate">{channel}</span>
                      {joinedVoiceChannel === channel && (
                        <span className="ml-auto rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                          {joinedVoiceUserCount}
                        </span>
                      )}
                    </Button>
                  </div>
                  <ChannelUserList channelId={channel} currentUserId={userId} userRole={userRole} userVolumes={userVolumes} peerQuality={peerQuality} onVolumeChange={onVolumeChange} onKickUser={onKickUser} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {joinedVoiceChannel && (
          <div className="border-t border-white/10 bg-black/15 p-3">
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] p-3 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-bold leading-none text-emerald-300">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]" />
                  Ses Bağlandı
                </div>
                <div className="max-w-[120px] truncate text-[11px] font-medium text-white/45">{joinedVoiceChannel}</div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label="Mikrofonu ac/kapat" className={cn("h-8 w-8 rounded-xl border border-white/8 bg-black/15 hover:bg-white/10", isMuted ? "text-red-300" : "text-white/60")} onClick={onToggleMute}>
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="icon" aria-label="Kulakligi ac/kapat" className={cn("h-8 w-8 rounded-xl border border-white/8 bg-black/15 hover:bg-white/10", isDeafened ? "text-red-300" : "text-white/60")} onClick={onToggleDeafen}>
                  <Headphones className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Sesten ayril" className="h-8 w-8 rounded-xl border border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/18 hover:text-red-100" onClick={onLeaveVoice}>
                  <PhoneOff className="w-4 h-4" />
                </Button>
              </div>
            </div>
            </div>
          </div>
        )}

        <div className="border-t border-white/10 bg-[#0d0c13]/90 p-3">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.045] p-2.5 shadow-inner">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative shrink-0">
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-sm font-bold text-white", isSpeaking && "ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#111019]")}>
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#191622] bg-emerald-400" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1">
                <span className="truncate text-sm font-bold text-white">{userName}</span>
                {userRole === 'admin' ? <ShieldCheck className="w-3 h-3 text-primary" /> : userRole === 'mod' ? <Shield className="w-3 h-3 text-accent" /> : null}
              </div>
              <span className="text-[10px] uppercase tracking-[0.16em] text-white/38">{userRole === 'admin' ? 'Admin' : userRole === 'mod' ? 'Mod' : 'Uye'}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Kullanici ayarlari" className="h-9 w-9 rounded-xl text-white/48 hover:bg-white/10 hover:text-white">
                  <Settings className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 border-white/10 bg-[#17151f] text-foreground shadow-2xl">
                <DropdownMenuItem onClick={onOpenSettings} className="gap-2 focus:bg-primary focus:text-white cursor-pointer">
                  <Volume2 className="w-4 h-4" />
                  Ses Ayarları
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={onOpenAdminPanel} className="gap-2 focus:bg-primary focus:text-white cursor-pointer">
                    <Settings2 className="w-4 h-4" />
                    Yönetim Paneli
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className="bg-white/5" />
                <DropdownMenuItem onClick={onLogout} className="gap-2 text-destructive focus:bg-destructive focus:text-white cursor-pointer">
                  <LogOut className="w-4 h-4" />
                  Çıkış Yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
