"use client"

import { Button } from '@/components/ui/button';
import { Hash, LogOut, Settings2, UserCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoomSidebarProps {
  rooms: string[];
  activeRoom: string;
  onRoomSelect: (room: string) => void;
  userName: string;
  onLogout: () => void;
}

export function RoomSidebar({ rooms, activeRoom, onRoomSelect, userName, onLogout }: RoomSidebarProps) {
  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border w-64">
      {/* Server Header */}
      <div className="h-14 flex items-center px-4 border-b border-sidebar-border shadow-sm">
        <h2 className="font-bold text-lg text-sidebar-foreground tracking-tight truncate">haruncord</h2>
      </div>

      {/* Rooms List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="text-[11px] font-bold text-muted-foreground uppercase px-2 mb-2 tracking-wider">Metin Kanalları</div>
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

      {/* User Status Bar */}
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
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-white/5"
            onClick={onLogout}
            title="Çıkış Yap"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
