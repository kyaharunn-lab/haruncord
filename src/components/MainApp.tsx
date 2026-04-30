"use client"

import { useState } from 'react';
import { RoomSidebar } from './RoomSidebar';
import { Hash, Users, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const SAMPLE_USERS = [
  { name: 'Arda', status: 'Sohbet ediyor', color: 'bg-red-400' },
  { name: 'Zeynep', status: 'Oyun oynuyor', color: 'bg-blue-400' },
  { name: 'Mert', status: 'Çevrimiçi', color: 'bg-green-400' },
  { name: 'Selin', status: 'Müzik dinliyor', color: 'bg-purple-400' },
];

interface MainAppProps {
  userName: string;
  onLogout: () => void;
}

export function MainApp({ userName, onLogout }: MainAppProps) {
  const rooms = ['Genel', 'Oyun', 'Muhabbet'];
  const [activeRoom, setActiveRoom] = useState(rooms[0]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <RoomSidebar 
        rooms={rooms} 
        activeRoom={activeRoom} 
        onRoomSelect={setActiveRoom} 
        userName={userName}
        onLogout={onLogout}
      />
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#312B38]">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-black/10 shadow-sm bg-card/20">
          <div className="flex items-center gap-2 font-semibold">
            <Hash className="w-5 h-5 text-muted-foreground" />
            <span className="text-foreground">{activeRoom}</span>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
            <Badge variant="secondary" className="bg-black/20 text-[10px] py-0 px-2">Beta</Badge>
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
              <div className="mt-8 p-3 bg-primary/10 border border-primary/20 rounded-lg max-w-sm text-xs text-primary font-medium">
                Sesli sohbet özelliği yakında eklenecek!
              </div>
            </div>
          </div>

          {/* Online Users Sidebar */}
          <aside className="w-60 bg-black/10 border-l border-black/5 hidden lg:block">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-6">
                <div>
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-2 mb-3">Çevrimiçi — {SAMPLE_USERS.length + 1}</h3>
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
                        <span className="text-[10px] text-muted-foreground truncate leading-none">Sende durum yok</span>
                      </div>
                    </div>

                    {/* Fake Users */}
                    {SAMPLE_USERS.map((user) => (
                      <div key={user.name} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer group opacity-80 hover:opacity-100">
                        <div className="relative">
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white font-bold", user.color)}>
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#312B38] rounded-full"></div>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-foreground truncate">{user.name}</span>
                          <span className="text-[10px] text-muted-foreground truncate leading-none">{user.status}</span>
                        </div>
                      </div>
                    ))}
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
